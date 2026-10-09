import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';

import type { Clock } from '../../src/application/ports/clock.js';
import { PendingReferenceRetryPolicy } from '../../src/application/services/pending-reference-retry.policy.js';
import { PersistentWagerTransactionProcessor } from '../../src/application/services/persistent-wager-transaction.processor.js';
import { WagerPayloadFingerprintService } from '../../src/application/services/wager-payload-fingerprint.js';
import { WagerTransactionExecutor } from '../../src/application/services/wager-transaction.executor.js';
import type { ProcessWagerTransactionCommand } from '../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import { ProcessWagerTransactionUseCase } from '../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import { Sha256PayloadDigest } from '../../src/infrastructure/cryptography/sha256-payload-digest.js';
import { UuidGenerator } from '../../src/infrastructure/identity/uuid-generator.js';
import { PERSISTENCE_ENTITIES } from '../../src/infrastructure/persistence/entities/persistence-entities.js';
import { MikroOrmPersistenceConflictClassifier } from '../../src/infrastructure/persistence/mikro-orm-persistence-conflict.classifier.js';
import { MikroOrmUnitOfWork } from '../../src/infrastructure/persistence/mikro-orm.unit-of-work.js';
import { SqsWagerMessageHandler } from '../../src/interfaces/messaging/sqs-wager-message.handler.js';

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }
}

const mode = requiredEnvironment('FINANCIAL_PROCESS_MODE');
const clock = new FixedClock(
  new Date(
    process.env.FINANCIAL_PROCESS_NOW ?? '2026-10-09T12:00:00.000Z',
  ),
);
const orm = await MikroORM.init({
  dbName: requiredEnvironment('FINANCIAL_PROCESS_DATABASE'),
  entities: [...PERSISTENCE_ENTITIES],
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  password: process.env.POSTGRES_PASSWORD ?? 'backend_challenge_local',
  pool: { max: 1, min: 1 },
  port: Number(process.env.POSTGRES_PORT ?? '5432'),
  user: process.env.POSTGRES_USER ?? 'backend_challenge',
});
const unitOfWork = new MikroOrmUnitOfWork(orm);
const useCase = new ProcessWagerTransactionUseCase(
  new PersistentWagerTransactionProcessor(
    unitOfWork,
    new WagerTransactionExecutor(
      new UuidGenerator(),
      clock,
      new PendingReferenceRetryPolicy(30, 3_600, 86_400),
    ),
    new MikroOrmPersistenceConflictClassifier(),
  ),
  new WagerPayloadFingerprintService(new Sha256PayloadDigest()),
);

if (mode === 'DIRECT') {
  const startAt = Number(requiredEnvironment('FINANCIAL_PROCESS_START_AT'));
  const command = JSON.parse(
    requiredEnvironment('FINANCIAL_PROCESS_COMMAND'),
  ) as ProcessWagerTransactionCommand;
  const remaining = startAt - Date.now();
  if (remaining > 0) {
    await Bun.sleep(remaining);
  }

  const result = await useCase.execute(command);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  await orm.close(true);
} else if (mode === 'SQS_CRASH' || mode === 'SQS_ACK') {
  const client = new SQSClient({
    endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
    },
  });
  const queueUrl = requiredEnvironment('FINANCIAL_PROCESS_QUEUE_URL');
  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 10,
      MessageSystemAttributeNames: [
        'ApproximateReceiveCount',
        'MessageGroupId',
      ],
    }),
  );
  const message = response.Messages?.[0];
  if (message?.ReceiptHandle === undefined) {
    throw new Error('Financial process worker received no SQS message.');
  }

  const result = await new SqsWagerMessageHandler(
    useCase,
    new Sha256PayloadDigest(),
    clock,
  ).handle(message.Body, message.Attributes?.MessageGroupId);
  process.stdout.write(
    `PROCESSED:${JSON.stringify({
      ...result,
      receiveCount: message.Attributes?.ApproximateReceiveCount,
    })}\n`,
  );

  if (mode === 'SQS_CRASH') {
    await new Promise<never>(() => undefined);
  }

  await client.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle,
    }),
  );
  process.stdout.write('ACKED\n');
  client.destroy();
  await orm.close(true);
} else {
  throw new Error(`Unsupported FINANCIAL_PROCESS_MODE: ${mode}`);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
