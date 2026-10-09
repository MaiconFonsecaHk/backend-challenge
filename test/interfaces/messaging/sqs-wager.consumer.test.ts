import { describe, expect, mock, test } from 'bun:test';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { ConfigService } from '@nestjs/config';

import type { OperationalLogger } from '../../../src/application/ports/operational-logger.js';
import type { OperationalMetrics } from '../../../src/application/ports/operational-metrics.js';
import type { EnvironmentVariables } from '../../../src/config/environment.schema.js';
import { SqsWagerConsumer } from '../../../src/interfaces/messaging/sqs-wager.consumer.js';
import { InvalidSqsWagerMessageError } from '../../../src/interfaces/messaging/sqs-wager-message.error.js';
import type { SqsWagerMessageHandler } from '../../../src/interfaces/messaging/sqs-wager-message.handler.js';

const QUEUE_URL = 'http://sqs.local/wager-transactions.fifo';
const DLQ_URL = 'http://sqs.local/wager-transactions-dlq.fifo';

describe('SQS wager consumer', () => {
  test('acks only after a message handler completes successfully', async () => {
    const deferred = promiseWithResolvers<void>();
    const commands: unknown[] = [];
    const consumer = consumerHarness(commands, async () => deferred.promise);
    const processing = processBatch(consumer, [message('message-1', 'wallet-a')]);

    await Promise.resolve();
    expect(commands.some((command) => command instanceof DeleteMessageCommand)).toBeFalse();

    deferred.resolve();
    await processing;

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteMessageCommand);
  });

  test('processes distinct wallet groups concurrently and each group in order', async () => {
    const firstWallet = promiseWithResolvers<void>();
    const started: string[] = [];
    const consumer = consumerHarness([], async (body) => {
      started.push(body ?? '');
      if (body === 'wallet-a-first') {
        await firstWallet.promise;
      }
    });
    const processing = processBatch(consumer, [
      message('message-a1', 'wallet-a', 'wallet-a-first'),
      message('message-a2', 'wallet-a', 'wallet-a-second'),
      message('message-b1', 'wallet-b', 'wallet-b-first'),
    ]);

    await Promise.resolve();
    expect(started).toEqual(['wallet-a-first', 'wallet-b-first']);

    firstWallet.resolve();
    await processing;
    expect(started).toEqual([
      'wallet-a-first',
      'wallet-b-first',
      'wallet-a-second',
    ]);
  });

  test('backs off a transient failure without acknowledging the message', async () => {
    const commands: unknown[] = [];
    const warn = mock(() => undefined);
    const recordRetry = mock(() => undefined);
    const transient = Object.assign(new Error('temporary timeout'), {
      code: 'ETIMEDOUT',
    });
    const consumer = consumerHarness(
      commands,
      async () => {
        throw transient;
      },
      operationalLogger({ warn }),
      operationalMetrics({ recordRetry }),
    );

    await processBatch(consumer, [
      message('message-2', 'wallet-a', '{}', '2'),
    ]);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(ChangeMessageVisibilityCommand);
    expect((commands[0] as ChangeMessageVisibilityCommand).input).toMatchObject({
      QueueUrl: QUEUE_URL,
      ReceiptHandle: 'receipt-message-2',
      VisibilityTimeout: 60,
    });
    expect(warn).toHaveBeenCalledWith('sqs.wager.retry.scheduled', {
      messageId: 'message-2',
      walletId: 'wallet-a',
      operation: 'WAGER_CONSUMPTION',
      status: 'RETRY_SCHEDULED',
      attempt: 2,
      retryable: true,
    });
    expect(recordRetry).toHaveBeenCalledWith('sqs_wager_consumer');
  });

  test('stops only the failed FIFO group after a transient error', async () => {
    const commands: unknown[] = [];
    const handled: string[] = [];
    const consumer = consumerHarness(commands, async (body) => {
      handled.push(body ?? '');
      if (body === 'wallet-a-first') {
        throw Object.assign(new Error('temporary timeout'), {
          code: 'ETIMEDOUT',
        });
      }
    });

    await processBatch(consumer, [
      message('message-a1', 'wallet-a', 'wallet-a-first'),
      message('message-a2', 'wallet-a', 'wallet-a-second'),
      message('message-b1', 'wallet-b', 'wallet-b-first'),
    ]);

    expect(handled).toEqual(['wallet-a-first', 'wallet-b-first']);
    expect(
      commands.filter(
        (command) => command instanceof ChangeMessageVisibilityCommand,
      ),
    ).toHaveLength(1);
    expect(
      commands.filter((command) => command instanceof DeleteMessageCommand),
    ).toHaveLength(1);
    expect(
      commands.some(
        (command) =>
          command instanceof DeleteMessageCommand &&
          command.input.ReceiptHandle === 'receipt-message-a2',
      ),
    ).toBeFalse();
  });

  test('leaves an exhausted transient message for native redrive', async () => {
    const commands: unknown[] = [];
    const consumer = consumerHarness(commands, async () => {
      throw Object.assign(new Error('temporary timeout'), { code: 'ETIMEDOUT' });
    });

    await processBatch(consumer, [
      message('message-3', 'wallet-a', '{}', '5'),
    ]);

    expect(commands).toEqual([]);
  });

  test('moves a permanent failure to the DLQ before deleting the source', async () => {
    const commands: unknown[] = [];
    const error = mock(() => undefined);
    const recordDeadLetterMessage = mock(() => undefined);
    const consumer = consumerHarness(
      commands,
      async () => {
        throw new InvalidSqsWagerMessageError();
      },
      operationalLogger({ error }),
      operationalMetrics({ recordDeadLetterMessage }),
    );

    await processBatch(consumer, [message('message-4', 'wallet-a')]);

    expect(commands).toHaveLength(2);
    expect(commands[0]).toBeInstanceOf(SendMessageCommand);
    expect((commands[0] as SendMessageCommand).input).toEqual({
      QueueUrl: DLQ_URL,
      MessageBody: '{}',
      MessageGroupId: 'wallet-a',
      MessageDeduplicationId: 'message-4',
    });
    expect(commands[1]).toBeInstanceOf(DeleteMessageCommand);
    expect(error).toHaveBeenCalledWith('sqs.wager.moved_to_dlq', {
      messageId: 'message-4',
      walletId: 'wallet-a',
      operation: 'WAGER_CONSUMPTION',
      status: 'DLQ',
      attempt: 1,
      retryable: false,
    });
    expect(recordDeadLetterMessage).toHaveBeenCalledTimes(1);
  });

  test('continues a FIFO group after a permanent message is moved to the DLQ', async () => {
    const commands: unknown[] = [];
    const handled: string[] = [];
    const consumer = consumerHarness(commands, async (body) => {
      handled.push(body ?? '');
      if (body === 'invalid-first') {
        throw new InvalidSqsWagerMessageError();
      }
    });

    await processBatch(consumer, [
      message('message-invalid', 'wallet-a', 'invalid-first'),
      message('message-valid', 'wallet-a', 'valid-second'),
    ]);

    expect(handled).toEqual(['invalid-first', 'valid-second']);
    expect(commands[0]).toBeInstanceOf(SendMessageCommand);
    expect(commands[1]).toBeInstanceOf(DeleteMessageCommand);
    expect(commands[2]).toBeInstanceOf(DeleteMessageCommand);
  });

  test('leaves a successfully processed message for redelivery when its ack fails', async () => {
    const commands: unknown[] = [];
    const ackFailure = Object.assign(new Error('lost ack'), {
      code: 'ETIMEDOUT',
    });
    const client = {
      send: mock(async (command: unknown) => {
        commands.push(command);
        throw ackFailure;
      }),
    } as unknown as SQSClient;
    const values: Partial<EnvironmentVariables> = {
      SQS_MAX_RECEIVE_COUNT: 5,
      SQS_VISIBILITY_TIMEOUT_SECONDS: 30,
      SQS_MAX_RETRY_VISIBILITY_SECONDS: 300,
    };
    const config = {
      get: (key: keyof EnvironmentVariables) => values[key],
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const consumer = new SqsWagerConsumer(
      client,
      config,
      { handle: mock(async () => undefined) } as unknown as SqsWagerMessageHandler,
    );
    const internals = consumer as unknown as {
      queueUrl: string;
      deadLetterQueueUrl: string;
    };
    internals.queueUrl = QUEUE_URL;
    internals.deadLetterQueueUrl = DLQ_URL;

    await expect(
      processBatch(consumer, [message('message-5', 'wallet-a')]),
    ).rejects.toBe(ackFailure);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteMessageCommand);
  });
});

function consumerHarness(
  commands: unknown[],
  handle: (body: string | undefined, group: string | undefined) => Promise<unknown>,
  logger?: OperationalLogger,
  metrics?: OperationalMetrics,
): SqsWagerConsumer {
  const client = {
    send: mock(async (command: unknown) => {
      commands.push(command);
      return {};
    }),
  } as unknown as SQSClient;
  const values: Partial<EnvironmentVariables> = {
    SQS_MAX_RECEIVE_COUNT: 5,
    SQS_VISIBILITY_TIMEOUT_SECONDS: 30,
    SQS_MAX_RETRY_VISIBILITY_SECONDS: 300,
  };
  const config = {
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const consumer = new SqsWagerConsumer(
    client,
    config,
    { handle } as unknown as SqsWagerMessageHandler,
    logger,
    metrics,
  );
  const internals = consumer as unknown as {
    queueUrl: string;
    deadLetterQueueUrl: string;
  };
  internals.queueUrl = QUEUE_URL;
  internals.deadLetterQueueUrl = DLQ_URL;
  return consumer;
}

function operationalLogger(overrides: Partial<OperationalLogger> = {}): OperationalLogger {
  return {
    info: overrides.info ?? (() => undefined),
    warn: overrides.warn ?? (() => undefined),
    error: overrides.error ?? (() => undefined),
  };
}

function operationalMetrics(overrides: Partial<OperationalMetrics>): OperationalMetrics {
  return {
    recordWagerOutcome: overrides.recordWagerOutcome ?? (() => undefined),
    recordRetry: overrides.recordRetry ?? (() => undefined),
    recordDeadLetterMessage:
      overrides.recordDeadLetterMessage ?? (() => undefined),
    recordLockConflict: overrides.recordLockConflict ?? (() => undefined),
    recordReconciliationDivergence:
      overrides.recordReconciliationDivergence ?? (() => undefined),
    setOutboxState: overrides.setOutboxState ?? (() => undefined),
    setReadiness: overrides.setReadiness ?? (() => undefined),
    recordCollectionFailure:
      overrides.recordCollectionFailure ?? (() => undefined),
    contentType: () => 'text/plain',
    render: async () => '',
  };
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

function message(
  id: string,
  group: string,
  body = '{}',
  receiveCount = '1',
): Message {
  return {
    MessageId: id,
    ReceiptHandle: `receipt-${id}`,
    Body: body,
    Attributes: {
      MessageGroupId: group,
      ApproximateReceiveCount: receiveCount,
    },
  };
}

function promiseWithResolvers<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
