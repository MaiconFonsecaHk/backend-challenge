import type { EntityManager } from '@mikro-orm/postgresql';

import type { InboxMessageRepository } from '../../../application/ports/persistence/repositories.js';
import type { InboxMessage } from '../../../domain/messaging/inbox-message.js';
import { InboxMessagePersistenceEntity } from '../entities/inbox-message.persistence-entity.js';
import { InboxMessagePersistenceMapper } from '../mappers/inbox-message.persistence-mapper.js';
import { PersistenceRecordNotFoundError } from './persistence-record-not-found.error.js';

export class MikroOrmInboxMessageRepository implements InboxMessageRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findByIdentity(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | undefined> {
    const entity = await this.entityManager.findOne(
      InboxMessagePersistenceEntity,
      { consumerName, messageId },
    );

    return entity === null
      ? undefined
      : InboxMessagePersistenceMapper.toDomain(entity);
  }

  async add(message: InboxMessage): Promise<void> {
    const entity = this.entityManager.create(
      InboxMessagePersistenceEntity,
      InboxMessagePersistenceMapper.toPersistence(message),
    );

    this.entityManager.persist(entity);
  }

  async save(message: InboxMessage): Promise<void> {
    const entity = await this.entityManager.findOne(
      InboxMessagePersistenceEntity,
      {
        consumerName: message.consumerName,
        messageId: message.messageId,
      },
    );

    if (entity === null) {
      throw new PersistenceRecordNotFoundError(
        'inbox message',
        `${message.consumerName}/${message.messageId}`,
      );
    }

    this.entityManager.assign(entity, {
      processedAt: message.processedAt ?? null,
    });
  }
}
