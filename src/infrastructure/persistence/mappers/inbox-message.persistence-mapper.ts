import { InboxMessage } from '../../../domain/messaging/inbox-message.js';
import type { InboxMessagePersistenceEntity } from '../entities/inbox-message.persistence-entity.js';

export interface InboxMessagePersistenceState {
  readonly consumerName: string;
  readonly messageId: string;
  readonly payloadHash: string;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

export class InboxMessagePersistenceMapper {
  static toDomain(entity: InboxMessagePersistenceEntity): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: entity.consumerName,
      messageId: entity.messageId,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt ?? undefined,
    });
  }

  static toPersistence(
    message: InboxMessage,
  ): InboxMessagePersistenceState {
    return {
      consumerName: message.consumerName,
      messageId: message.messageId,
      payloadHash: message.payloadHash,
      receivedAt: message.receivedAt,
      processedAt: message.processedAt ?? null,
    };
  }
}
