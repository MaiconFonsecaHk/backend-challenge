import type { Clock } from '../../ports/clock.js';
import {
  NOOP_OPERATIONAL_LOGGER,
  type OperationalLogContext,
  type OperationalLogger,
} from '../../ports/operational-logger.js';
import {
  NOOP_OPERATIONAL_METRICS,
  type OperationalMetrics,
} from '../../ports/operational-metrics.js';
import type {
  OutboxEventPublication,
  OutboxEventTransport,
} from '../../ports/outbox-event-transport.js';
import type { UnitOfWork } from '../../ports/persistence/unit-of-work.js';
import type { OutboxRetryPolicy } from '../../../domain/messaging/outbox-message.js';

export interface PublishOutboxBatchResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}

export class PublishOutboxBatchUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly transport: OutboxEventTransport,
    private readonly clock: Clock,
    private readonly retryPolicy: OutboxRetryPolicy,
    private readonly logger: OperationalLogger = NOOP_OPERATIONAL_LOGGER,
    private readonly metrics: OperationalMetrics = NOOP_OPERATIONAL_METRICS,
  ) {}

  async execute(limit: number): Promise<PublishOutboxBatchResult> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Outbox batch limit must be a positive safe integer.');
    }

    const execution = await this.unitOfWork.execute(async (repositories) => {
      const messages = await repositories.outboxMessages.findDueForUpdate(
        this.clock.now(),
        limit,
      );
      let published = 0;
      let failed = 0;
      const retries: OperationalLogContext[] = [];

      for (const message of messages) {
        try {
          await this.transport.publish(
            Object.freeze<OutboxEventPublication>({
              id: message.id,
              aggregateId: message.aggregateId,
              eventType: message.eventType,
              payload: message.payload,
            }),
          );
          message.markPublished(this.clock.now());
          published += 1;
        } catch {
          message.scheduleRetry(this.clock.now(), this.retryPolicy);
          failed += 1;
          retries.push({
            eventId: message.id,
            eventType: message.eventType,
            operation: 'OUTBOX_PUBLICATION',
            status: 'RETRY_SCHEDULED',
            attempt: message.attempts,
            retryable: true,
          });
        }

        await repositories.outboxMessages.save(message);
      }

      return Object.freeze({
        result: Object.freeze({
          claimed: messages.length,
          published,
          failed,
        }),
        retries: Object.freeze(retries),
      });
    });

    for (const context of execution.retries) {
      this.logger.warn('outbox.publish.retry_scheduled', context);
      this.metrics.recordRetry('outbox_publisher');
    }
    return execution.result;
  }
}
