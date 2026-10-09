import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  ChangeMessageVisibilityCommand,
  CreateQueueCommand,
  DeleteMessageCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import type { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../../src/config/environment.schema.js';
import { SqsOutboxEventTransport } from '../../../src/infrastructure/messaging/sqs-outbox-event.transport.js';
import { SqsWagerConsumer } from '../../../src/interfaces/messaging/sqs-wager.consumer.js';
import { InvalidSqsWagerMessageError } from '../../../src/interfaces/messaging/sqs-wager-message.error.js';
import type { SqsWagerMessageHandler } from '../../../src/interfaces/messaging/sqs-wager-message.handler.js';

const integrationEnabled = process.env.RUN_SQS_INTEGRATION_TESTS === 'true';
const describeSqs = integrationEnabled ? describe : describe.skip;
const VISIBILITY_SECONDS = 1;
const MAX_RECEIVE_COUNT = 2;

let client: SQSClient | undefined;
let queueUrl = '';
let deadLetterQueueUrl = '';
let integrationEventsQueueName = '';
let integrationEventsQueueUrl = '';

describeSqs('SQS wager consumer integration', () => {
  beforeAll(async () => {
    client = new SQSClient({
      endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    const deadLetterQueueName = `wager-it-${suffix}-dlq.fifo`;
    const queueName = `wager-it-${suffix}.fifo`;
    integrationEventsQueueName = `events-it-${suffix}.fifo`;
    const deadLetterQueue = await client.send(
      new CreateQueueCommand({
        QueueName: deadLetterQueueName,
        Attributes: { FifoQueue: 'true' },
      }),
    );
    if (deadLetterQueue.QueueUrl === undefined) {
      throw new Error('SQS did not return the integration DLQ URL.');
    }
    deadLetterQueueUrl = deadLetterQueue.QueueUrl;
    const deadLetterAttributes = await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: deadLetterQueueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
    const deadLetterQueueArn = deadLetterAttributes.Attributes?.QueueArn;
    if (deadLetterQueueArn === undefined) {
      throw new Error('SQS did not return the integration DLQ ARN.');
    }

    const queue = await client.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: {
          FifoQueue: 'true',
          VisibilityTimeout: String(VISIBILITY_SECONDS),
          RedrivePolicy: JSON.stringify({
            deadLetterTargetArn: deadLetterQueueArn,
            maxReceiveCount: String(MAX_RECEIVE_COUNT),
          }),
        },
      }),
    );
    if (queue.QueueUrl === undefined) {
      throw new Error('SQS did not return the integration queue URL.');
    }
    queueUrl = queue.QueueUrl;

    const integrationEventsQueue = await client.send(
      new CreateQueueCommand({
        QueueName: integrationEventsQueueName,
        Attributes: { FifoQueue: 'true' },
      }),
    );
    if (integrationEventsQueue.QueueUrl === undefined) {
      throw new Error('SQS did not return the integration events queue URL.');
    }
    integrationEventsQueueUrl = integrationEventsQueue.QueueUrl;
  });

  afterAll(async () => {
    if (client === undefined) {
      return;
    }
    if (queueUrl.length > 0) {
      await client.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    }
    if (deadLetterQueueUrl.length > 0) {
      await client.send(
        new DeleteQueueCommand({ QueueUrl: deadLetterQueueUrl }),
      );
    }
    if (integrationEventsQueueUrl.length > 0) {
      await client.send(
        new DeleteQueueCommand({ QueueUrl: integrationEventsQueueUrl }),
      );
    }
    client.destroy();
    client = undefined;
  });

  test('redelivers after an ack failure without losing the committed result', async () => {
    const actualClient = requiredClient();
    const messageBody = '{"scenario":"ack-after-commit"}';
    await send(messageBody, 'wallet-ack', 'ack-after-commit');
    const firstDelivery = await receiveRequired(queueUrl);
    let handleCalls = 0;
    let failFirstDelete = true;
    const faultInjectingClient = {
      send: async (command: unknown) => {
        if (command instanceof DeleteMessageCommand && failFirstDelete) {
          failFirstDelete = false;
          throw Object.assign(new Error('simulated lost ack'), {
            code: 'ETIMEDOUT',
          });
        }
        return actualClient.send(command as never);
      },
    } as unknown as SQSClient;
    const consumer = consumerHarness(faultInjectingClient, async () => {
      handleCalls += 1;
    });

    await expect(processBatch(consumer, [firstDelivery])).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
    const redelivery = await receiveRequired(queueUrl, 8_000);
    expect(redelivery.MessageId).toBe(firstDelivery.MessageId);
    expect(redelivery.Attributes?.ApproximateReceiveCount).toBe('2');
    await processBatch(consumer, [redelivery]);

    expect(handleCalls).toBe(2);
    expect(await receive(queueUrl, 1)).toBeUndefined();
  }, 15_000);

  test('moves permanent failures directly to the real DLQ before ack', async () => {
    const messageBody = '{"scenario":"permanent"}';
    await send(messageBody, 'wallet-permanent', 'permanent');
    const delivery = await receiveRequired(queueUrl);
    const consumer = consumerHarness(requiredClient(), async () => {
      throw new InvalidSqsWagerMessageError();
    });

    await processBatch(consumer, [delivery]);

    const deadLetter = await receiveRequired(deadLetterQueueUrl);
    expect(deadLetter.Body).toBe(messageBody);
    await requiredClient().send(
      new DeleteMessageCommand({
        QueueUrl: deadLetterQueueUrl,
        ReceiptHandle: deadLetter.ReceiptHandle,
      }),
    );
    expect(await receive(queueUrl, 1)).toBeUndefined();
  });

  test('retries transient failures and relies on native redrive at the limit', async () => {
    const messageBody = '{"scenario":"transient"}';
    await send(messageBody, 'wallet-transient', 'transient');
    const consumer = consumerHarness(requiredClient(), async () => {
      throw Object.assign(new Error('simulated database timeout'), {
        code: 'ETIMEDOUT',
      });
    });
    const firstDelivery = await receiveRequired(queueUrl);
    await processBatch(consumer, [firstDelivery]);

    const secondDelivery = await receiveRequired(queueUrl, 8_000);
    expect(secondDelivery.Attributes?.ApproximateReceiveCount).toBe('2');
    await processBatch(consumer, [secondDelivery]);

    const deadLetter = await waitForNativeRedrive();
    expect(deadLetter.Body).toBe(messageBody);
    expect(await receive(queueUrl, 1)).toBeUndefined();
  }, 20_000);

  test('does not advance a FIFO group after its first message fails transiently', async () => {
    const groupId = 'wallet-ordered-retry';
    const firstBody = '{"sequence":1}';
    const secondBody = '{"sequence":2}';
    await send(firstBody, groupId, 'ordered-retry-1');
    await send(secondBody, groupId, 'ordered-retry-2');
    const batch = await receiveBatchRequired(queueUrl, 2);
    expect(batch.map((message) => message.Body)).toEqual([
      firstBody,
      secondBody,
    ]);

    const handled: string[] = [];
    let failFirst = true;
    const consumer = consumerHarness(requiredClient(), async (body) => {
      handled.push(body ?? '');
      if (body === firstBody && failFirst) {
        failFirst = false;
        throw Object.assign(new Error('simulated database timeout'), {
          code: 'ETIMEDOUT',
        });
      }
    });

    await processBatch(consumer, batch);
    expect(handled).toEqual([firstBody]);

    const firstRedelivery = await receiveRequired(queueUrl, 8_000);
    expect(firstRedelivery.Body).toBe(firstBody);
    expect(firstRedelivery.Attributes?.ApproximateReceiveCount).toBe('2');
    await processBatch(consumer, [firstRedelivery]);

    const secondDelivery = await receiveRequired(queueUrl, 8_000);
    expect(secondDelivery.Body).toBe(secondBody);
    await processBatch(consumer, [secondDelivery]);
    expect(handled).toEqual([firstBody, firstBody, secondBody]);
    expect(await receive(queueUrl, 1)).toBeUndefined();
  }, 20_000);

  test('publishes an outbox envelope with aggregate ordering and event deduplication', async () => {
    const eventId = '50000000-0000-4000-8000-000000000811';
    const aggregateId = '10000000-0000-4000-8000-000000000811';
    const payload = {
      eventId,
      eventType: 'WalletBalanceChanged',
      aggregateId,
      correlationId: 'outbox-sqs-811',
      occurredAt: '2026-10-09T12:00:00.000Z',
      version: 1,
      data: { walletId: aggregateId },
    };
    const config = {
      get: () => integrationEventsQueueName,
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const transport = new SqsOutboxEventTransport(requiredClient(), config);

    await transport.publish({
      id: eventId,
      aggregateId,
      eventType: 'WalletBalanceChanged',
      payload,
    });

    const received = await receiveRequired(integrationEventsQueueUrl);
    expect(JSON.parse(received.Body ?? '')).toEqual(payload);
    expect(received.Attributes?.MessageGroupId).toBe(aggregateId);
    expect(received.MessageAttributes?.eventType?.StringValue).toBe(
      'WalletBalanceChanged',
    );
  });
});

function requiredClient(): SQSClient {
  if (client === undefined) {
    throw new Error('SQS integration client is not initialized.');
  }
  return client;
}

function consumerHarness(
  sqsClient: SQSClient,
  handle: (
    body?: string,
    messageGroupId?: string,
  ) => Promise<unknown>,
): SqsWagerConsumer {
  const values: Partial<EnvironmentVariables> = {
    SQS_MAX_RECEIVE_COUNT: MAX_RECEIVE_COUNT,
    SQS_VISIBILITY_TIMEOUT_SECONDS: VISIBILITY_SECONDS,
    SQS_MAX_RETRY_VISIBILITY_SECONDS: VISIBILITY_SECONDS,
  };
  const config = {
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const consumer = new SqsWagerConsumer(
    sqsClient,
    config,
    { handle } as unknown as SqsWagerMessageHandler,
  );
  const internals = consumer as unknown as {
    queueUrl: string;
    deadLetterQueueUrl: string;
  };
  internals.queueUrl = queueUrl;
  internals.deadLetterQueueUrl = deadLetterQueueUrl;
  return consumer;
}

function processBatch(
  consumer: SqsWagerConsumer,
  messages: readonly Message[],
): Promise<void> {
  return (
    consumer as unknown as {
      processBatch(batch: readonly Message[]): Promise<void>;
    }
  ).processBatch(messages);
}

async function send(
  body: string,
  groupId: string,
  deduplicationId: string,
): Promise<void> {
  await requiredClient().send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: body,
      MessageGroupId: groupId,
      MessageDeduplicationId: deduplicationId,
    }),
  );
}

async function receive(
  targetQueueUrl: string,
  waitTimeSeconds = 2,
): Promise<Message | undefined> {
  const response = await requiredClient().send(
    new ReceiveMessageCommand({
      QueueUrl: targetQueueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: waitTimeSeconds,
      MessageSystemAttributeNames: [
        'ApproximateReceiveCount',
        'MessageGroupId',
      ],
      MessageAttributeNames: ['All'],
    }),
  );
  return response.Messages?.[0];
}

async function receiveRequired(
  targetQueueUrl: string,
  timeoutMilliseconds = 5_000,
): Promise<Message> {
  const deadline = Date.now() + timeoutMilliseconds;
  do {
    const message = await receive(targetQueueUrl, 1);
    if (message !== undefined) {
      return message;
    }
  } while (Date.now() < deadline);

  throw new Error(`No SQS message arrived at ${targetQueueUrl}.`);
}

async function receiveBatchRequired(
  targetQueueUrl: string,
  expectedCount: number,
  timeoutMilliseconds = 5_000,
): Promise<readonly Message[]> {
  const deadline = Date.now() + timeoutMilliseconds;
  do {
    const response = await requiredClient().send(
      new ReceiveMessageCommand({
        QueueUrl: targetQueueUrl,
        MaxNumberOfMessages: expectedCount,
        WaitTimeSeconds: 1,
        MessageSystemAttributeNames: [
          'ApproximateReceiveCount',
          'MessageGroupId',
        ],
      }),
    );
    if (response.Messages?.length === expectedCount) {
      return response.Messages;
    }
  } while (Date.now() < deadline);

  throw new Error(
    `SQS did not return a batch of ${expectedCount} messages from ${targetQueueUrl}.`,
  );
}

async function waitForNativeRedrive(): Promise<Message> {
  const deadline = Date.now() + 8_000;
  do {
    const deadLetter = await receive(deadLetterQueueUrl, 1);
    if (deadLetter !== undefined) {
      return deadLetter;
    }
    const sourceMessage = await receive(queueUrl, 1);
    if (sourceMessage !== undefined) {
      await requiredClient().send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: sourceMessage.ReceiptHandle,
          VisibilityTimeout: 0,
        }),
      );
    }
  } while (Date.now() < deadline);

  throw new Error('SQS did not redrive the exhausted message in time.');
}
