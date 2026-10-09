import { createHash } from 'node:crypto';

import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../config/environment.schema.js';
import {
  OPERATIONAL_LOGGER,
  NOOP_OPERATIONAL_LOGGER,
  type OperationalLogger,
} from '../../application/ports/operational-logger.js';
import {
  OPERATIONAL_METRICS,
  NOOP_OPERATIONAL_METRICS,
  type OperationalMetrics,
} from '../../application/ports/operational-metrics.js';
import { SQS_CLIENT } from '../../infrastructure/messaging/sqs.constants.js';
import {
  isTransientWagerMessageError,
  retryVisibilitySeconds,
} from './sqs-wager-error-policy.js';
import { SqsWagerMessageHandler } from './sqs-wager-message.handler.js';

const RECEIVE_BATCH_SIZE = 10;
const LONG_POLL_SECONDS = 20;
const POLL_FAILURE_DELAY_MS = 1_000;

@Injectable()
export class SqsWagerConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private running = false;
  private loop?: Promise<void>;
  private receiveAbortController?: AbortController;
  private queueUrl?: string;
  private deadLetterQueueUrl?: string;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly handler: SqsWagerMessageHandler,
    @Inject(OPERATIONAL_LOGGER)
    private readonly logger: OperationalLogger = NOOP_OPERATIONAL_LOGGER,
    @Inject(OPERATIONAL_METRICS)
    private readonly metrics: OperationalMetrics = NOOP_OPERATIONAL_METRICS,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    [this.queueUrl, this.deadLetterQueueUrl] = await Promise.all([
      this.getQueueUrl('WAGER_TRANSACTIONS_QUEUE_NAME'),
      this.getQueueUrl('WAGER_TRANSACTIONS_DLQ_NAME'),
    ]);
    this.running = true;
    this.loop = this.consume();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.receiveAbortController?.abort();
    await this.loop;
  }

  private async consume(): Promise<void> {
    while (this.running) {
      try {
        this.receiveAbortController = new AbortController();
        const response = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.requireQueueUrl(),
            MaxNumberOfMessages: RECEIVE_BATCH_SIZE,
            WaitTimeSeconds: LONG_POLL_SECONDS,
            MessageSystemAttributeNames: [
              'ApproximateReceiveCount',
              'MessageGroupId',
            ],
          }),
          { abortSignal: this.receiveAbortController.signal },
        );
        this.receiveAbortController = undefined;
        await this.processBatch(response.Messages ?? []);
      } catch (error) {
        this.receiveAbortController = undefined;
        if (!this.running) {
          return;
        }

        this.logger.error('sqs.poll.failed', {
          operation: 'RECEIVE',
          errorType: errorType(error),
          retryable: true,
        });
        await delay(POLL_FAILURE_DELAY_MS);
      }
    }
  }

  private async processBatch(messages: readonly Message[]): Promise<void> {
    const groups = new Map<string, Message[]>();
    for (const message of messages) {
      const group = message.Attributes?.MessageGroupId ?? message.MessageId ?? '';
      const grouped = groups.get(group) ?? [];
      grouped.push(message);
      groups.set(group, grouped);
    }

    await Promise.all(
      [...groups.values()].map(async (group) => {
        for (const message of group) {
          await this.processMessage(message);
        }
      }),
    );
  }

  private async processMessage(message: Message): Promise<void> {
    const receiptHandle = message.ReceiptHandle;
    if (receiptHandle === undefined) {
      return;
    }

    try {
      await this.handler.handle(
        message.Body,
        message.Attributes?.MessageGroupId,
      );
    } catch (error) {
      if (isTransientWagerMessageError(error)) {
        await this.scheduleRetry(message, receiptHandle);
        return;
      }

      await this.moveToDeadLetterQueue(message);
      await this.deleteMessage(receiptHandle);
      return;
    }

    await this.deleteMessage(receiptHandle);
  }

  private async scheduleRetry(
    message: Message,
    receiptHandle: string,
  ): Promise<void> {
    const receiveCount = parseReceiveCount(
      message.Attributes?.ApproximateReceiveCount,
    );
    const maximumReceives = this.config.get('SQS_MAX_RECEIVE_COUNT', {
      infer: true,
    });
    if (receiveCount >= maximumReceives) {
      this.logger.warn('sqs.wager.retry.exhausted', {
        ...(message.MessageId === undefined
          ? {}
          : { messageId: message.MessageId }),
        ...(message.Attributes?.MessageGroupId === undefined
          ? {}
          : { walletId: message.Attributes.MessageGroupId }),
        operation: 'WAGER_CONSUMPTION',
        status: 'AWAITING_REDRIVE',
        attempt: receiveCount,
      });
      return;
    }

    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.requireQueueUrl(),
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: retryVisibilitySeconds(
          receiveCount,
          this.config.get('SQS_VISIBILITY_TIMEOUT_SECONDS', { infer: true }),
          this.config.get('SQS_MAX_RETRY_VISIBILITY_SECONDS', { infer: true }),
        ),
      }),
    );
    this.logger.warn('sqs.wager.retry.scheduled', {
      ...(message.MessageId === undefined
        ? {}
        : { messageId: message.MessageId }),
      ...(message.Attributes?.MessageGroupId === undefined
        ? {}
        : { walletId: message.Attributes.MessageGroupId }),
      operation: 'WAGER_CONSUMPTION',
      status: 'RETRY_SCHEDULED',
      attempt: receiveCount,
      retryable: true,
    });
    this.metrics.recordRetry('sqs_wager_consumer');
  }

  private async moveToDeadLetterQueue(message: Message): Promise<void> {
    const body = message.Body ?? '';
    const messageIdentity =
      message.MessageId ?? createHash('sha256').update(body).digest('hex');

    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.requireDeadLetterQueueUrl(),
        MessageBody: body,
        MessageGroupId:
          message.Attributes?.MessageGroupId ?? 'invalid-message-group',
        MessageDeduplicationId: messageIdentity,
      }),
    );
    this.logger.error('sqs.wager.moved_to_dlq', {
      ...(message.MessageId === undefined
        ? {}
        : { messageId: message.MessageId }),
      ...(message.Attributes?.MessageGroupId === undefined
        ? {}
        : { walletId: message.Attributes.MessageGroupId }),
      operation: 'WAGER_CONSUMPTION',
      status: 'DLQ',
      attempt: parseReceiveCount(message.Attributes?.ApproximateReceiveCount),
      retryable: false,
    });
    this.metrics.recordDeadLetterMessage();
  }

  private deleteMessage(receiptHandle: string): Promise<unknown> {
    return this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.requireQueueUrl(),
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  private async getQueueUrl(
    name: 'WAGER_TRANSACTIONS_QUEUE_NAME' | 'WAGER_TRANSACTIONS_DLQ_NAME',
  ): Promise<string> {
    const response = await this.client.send(
      new GetQueueUrlCommand({
        QueueName: this.config.get(name, { infer: true }),
      }),
    );
    if (response.QueueUrl === undefined) {
      throw new Error(`SQS did not return the URL for ${name}.`);
    }

    return response.QueueUrl;
  }

  private requireQueueUrl(): string {
    if (this.queueUrl === undefined) {
      throw new Error('The wagering queue URL is not initialized.');
    }
    return this.queueUrl;
  }

  private requireDeadLetterQueueUrl(): string {
    if (this.deadLetterQueueUrl === undefined) {
      throw new Error('The wagering DLQ URL is not initialized.');
    }
    return this.deadLetterQueueUrl;
  }
}

function parseReceiveCount(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    return 1;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}
