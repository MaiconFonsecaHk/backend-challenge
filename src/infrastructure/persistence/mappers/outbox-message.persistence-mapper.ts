import { OutboxMessage } from '../../../domain/messaging/outbox-message.js';
import type { OutboxMessagePersistenceEntity } from '../entities/outbox-message.persistence-entity.js';

export interface OutboxMessagePersistenceState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt: Date | null;
  readonly publishedAt: Date | null;
}

export class OutboxMessagePersistenceMapper {
  static toDomain(entity: OutboxMessagePersistenceEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt ?? undefined,
      publishedAt: entity.publishedAt ?? undefined,
    });
  }

  static toPersistence(
    message: OutboxMessage,
  ): OutboxMessagePersistenceState {
    return {
      id: message.id,
      aggregateId: message.aggregateId,
      eventType: message.eventType,
      payload: message.payload,
      occurredAt: message.occurredAt,
      attempts: message.attempts,
      nextAttemptAt: message.nextAttemptAt ?? null,
      publishedAt: message.publishedAt ?? null,
    };
  }
}
