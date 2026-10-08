import type { EntityManager } from '@mikro-orm/postgresql';

import type { OutboxMessageRepository } from '../../../application/ports/persistence/repositories.js';
import type { OutboxMessage } from '../../../domain/messaging/outbox-message.js';
import { OutboxMessagePersistenceEntity } from '../entities/outbox-message.persistence-entity.js';
import { OutboxMessagePersistenceMapper } from '../mappers/outbox-message.persistence-mapper.js';
import { PersistenceRecordNotFoundError } from './persistence-record-not-found.error.js';

export class MikroOrmOutboxMessageRepository implements OutboxMessageRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string): Promise<OutboxMessage | undefined> {
    const entity = await this.entityManager.findOne(
      OutboxMessagePersistenceEntity,
      { id },
    );

    return entity === null
      ? undefined
      : OutboxMessagePersistenceMapper.toDomain(entity);
  }

  async add(message: OutboxMessage): Promise<void> {
    const entity = this.entityManager.create(
      OutboxMessagePersistenceEntity,
      OutboxMessagePersistenceMapper.toPersistence(message),
    );

    this.entityManager.persist(entity);
  }

  async save(message: OutboxMessage): Promise<void> {
    const entity = await this.entityManager.findOne(
      OutboxMessagePersistenceEntity,
      { id: message.id },
    );

    if (entity === null) {
      throw new PersistenceRecordNotFoundError('outbox message', message.id);
    }

    const state = OutboxMessagePersistenceMapper.toPersistence(message);
    this.entityManager.assign(entity, {
      attempts: state.attempts,
      nextAttemptAt: state.nextAttemptAt,
      publishedAt: state.publishedAt,
    });
  }
}
