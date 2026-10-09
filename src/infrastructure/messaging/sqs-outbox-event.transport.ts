import {
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  OutboxEventPublication,
  OutboxEventTransport,
} from '../../application/ports/outbox-event-transport.js';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { SQS_CLIENT } from './sqs.constants.js';

@Injectable()
export class SqsOutboxEventTransport implements OutboxEventTransport {
  private queueUrl?: string;

  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async publish(event: OutboxEventPublication): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: await this.requireQueueUrl(),
        MessageBody: JSON.stringify(event.payload),
        MessageGroupId: event.aggregateId,
        MessageDeduplicationId: event.id,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: event.eventType },
        },
      }),
    );
  }

  private async requireQueueUrl(): Promise<string> {
    if (this.queueUrl !== undefined) {
      return this.queueUrl;
    }

    const response = await this.client.send(
      new GetQueueUrlCommand({
        QueueName: this.config.get('INTEGRATION_EVENTS_QUEUE_NAME', {
          infer: true,
        }),
      }),
    );
    if (response.QueueUrl === undefined) {
      throw new Error('SQS did not return the integration events queue URL.');
    }

    this.queueUrl = response.QueueUrl;
    return response.QueueUrl;
  }
}
