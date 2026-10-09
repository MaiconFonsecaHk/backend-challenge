import { describe, expect, mock, test } from 'bun:test';
import {
  GetQueueUrlCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';
import type { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../../src/config/environment.schema.js';
import { SqsOutboxEventTransport } from '../../../src/infrastructure/messaging/sqs-outbox-event.transport.js';

describe('SqsOutboxEventTransport', () => {
  test('publishes the persisted envelope with aggregate ordering and event deduplication', async () => {
    const commands: unknown[] = [];
    const client = {
      send: mock(async (command: unknown) => {
        commands.push(command);
        return command instanceof GetQueueUrlCommand
          ? { QueueUrl: 'http://sqs.local/integration-events.fifo' }
          : {};
      }),
    } as unknown as SQSClient;
    const config = {
      get: () => 'integration-events.fifo',
    } as unknown as ConfigService<EnvironmentVariables, true>;
    const transport = new SqsOutboxEventTransport(client, config);
    const payload = Object.freeze({
      eventId: '50000000-0000-4000-8000-000000000801',
      eventType: 'WalletBalanceChanged',
      aggregateId: '10000000-0000-4000-8000-000000000801',
      correlationId: 'correlation-801',
      occurredAt: '2026-10-09T12:00:00.000Z',
      version: 1,
      data: Object.freeze({ walletId: '10000000-0000-4000-8000-000000000801' }),
    });

    await transport.publish({
      id: payload.eventId,
      aggregateId: payload.aggregateId,
      eventType: payload.eventType,
      payload,
    });
    await transport.publish({
      id: '50000000-0000-4000-8000-000000000802',
      aggregateId: payload.aggregateId,
      eventType: payload.eventType,
      payload: { ...payload, eventId: '50000000-0000-4000-8000-000000000802' },
    });

    expect(commands).toHaveLength(3);
    expect(commands[0]).toBeInstanceOf(GetQueueUrlCommand);
    expect((commands[0] as GetQueueUrlCommand).input).toEqual({
      QueueName: 'integration-events.fifo',
    });
    expect(commands[1]).toBeInstanceOf(SendMessageCommand);
    expect((commands[1] as SendMessageCommand).input).toEqual({
      QueueUrl: 'http://sqs.local/integration-events.fifo',
      MessageBody: JSON.stringify(payload),
      MessageGroupId: payload.aggregateId,
      MessageDeduplicationId: payload.eventId,
      MessageAttributes: {
        eventType: {
          DataType: 'String',
          StringValue: 'WalletBalanceChanged',
        },
      },
    });
    expect(commands[2]).toBeInstanceOf(SendMessageCommand);
  });
});
