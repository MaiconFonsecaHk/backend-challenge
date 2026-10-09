import type { EntityManager } from '@mikro-orm/postgresql';

import type { OutboxMessageRepository } from '../../../application/ports/persistence/repositories.js';
import { OutboxMessage } from '../../../domain/messaging/outbox-message.js';
import { OutboxMessagePersistenceEntity } from '../entities/outbox-message.persistence-entity.js';
import { OutboxMessagePersistenceMapper } from '../mappers/outbox-message.persistence-mapper.js';
import { PersistenceRecordNotFoundError } from './persistence-record-not-found.error.js';

interface DueOutboxRow {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date | string;
  readonly attempts: number;
  readonly nextAttemptAt: Date | string | null;
  readonly publishedAt: Date | string | null;
}

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

  async findDueForUpdate(
    now: Date,
    limit: number,
  ): Promise<readonly OutboxMessage[]> {
    const rows = await this.entityManager.execute<DueOutboxRow[]>(
      `select
         candidate.id,
         candidate.aggregate_id as "aggregateId",
         candidate.event_type as "eventType",
         candidate.payload,
         candidate.occurred_at as "occurredAt",
         candidate.attempts,
         candidate.next_attempt_at as "nextAttemptAt",
         candidate.published_at as "publishedAt"
       from outbox_messages candidate
       where candidate.published_at is null
         and (candidate.next_attempt_at is null or candidate.next_attempt_at <= ?)
         and not exists (
           select 1
             from outbox_messages earlier
            where earlier.aggregate_id = candidate.aggregate_id
              and earlier.published_at is null
              and (
                earlier.occurred_at < candidate.occurred_at
                or (
                  earlier.occurred_at = candidate.occurred_at
                  and earlier.id < candidate.id
                )
              )
         )
       order by candidate.next_attempt_at asc nulls first,
                candidate.occurred_at asc,
                candidate.id asc
       limit ?
       for update of candidate skip locked`,
      [now, limit],
      'all',
    );

    return rows.map((row) =>
      OutboxMessage.rehydrate({
        id: row.id,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: row.payload,
        occurredAt: parsePostgreSqlTimestamp(row.occurredAt),
        attempts: row.attempts,
        ...(row.nextAttemptAt === null
          ? {}
          : { nextAttemptAt: parsePostgreSqlTimestamp(row.nextAttemptAt) }),
        ...(row.publishedAt === null
          ? {}
          : { publishedAt: parsePostgreSqlTimestamp(row.publishedAt) }),
      }),
    );
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

function parsePostgreSqlTimestamp(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
