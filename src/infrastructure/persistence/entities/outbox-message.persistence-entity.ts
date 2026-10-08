import { defineEntity, p } from '@mikro-orm/postgresql';

const OutboxMessagePersistenceSchema = defineEntity({
  name: 'OutboxMessagePersistenceEntity',
  tableName: 'outbox_messages',
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.uuid().fieldName('aggregate_id'),
    eventType: p.text().fieldName('event_type'),
    payload: p
      .json<Readonly<Record<string, unknown>>>()
      .columnType('jsonb'),
    occurredAt: p.datetime().columnType('timestamptz').fieldName('occurred_at'),
    attempts: p.integer(),
    nextAttemptAt: p
      .datetime()
      .columnType('timestamptz')
      .nullable()
      .fieldName('next_attempt_at'),
    publishedAt: p
      .datetime()
      .columnType('timestamptz')
      .nullable()
      .fieldName('published_at'),
  },
});

export class OutboxMessagePersistenceEntity extends OutboxMessagePersistenceSchema.class {}

OutboxMessagePersistenceSchema.setClass(OutboxMessagePersistenceEntity);
