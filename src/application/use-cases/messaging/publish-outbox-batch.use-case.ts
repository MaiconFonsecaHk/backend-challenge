import type { Clock } from '../../ports/clock.js';
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
  ) {}

  execute(limit: number): Promise<PublishOutboxBatchResult> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error('Outbox batch limit must be a positive safe integer.');
    }

    return this.unitOfWork.execute(async (repositories) => {
      const messages = await repositories.outboxMessages.findDueForUpdate(
        this.clock.now(),
        limit,
      );
      let published = 0;
      let failed = 0;

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
        }

        await repositories.outboxMessages.save(message);
      }

      return Object.freeze({
        claimed: messages.length,
        published,
        failed,
      });
    });
  }
}
