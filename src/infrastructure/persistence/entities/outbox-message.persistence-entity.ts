import { defineEntity, p } from '@mikro-orm/postgresql';

const OutboxMessagePersistenceSchema = defineEntity({
  name: 'OutboxMessagePersistenceEntity',
  tableName: 'outbox_messages',
  checks: [
    {
      name: 'outbox_messages_event_type_not_blank_check',
      expression: (columns) => `length(btrim(${columns.eventType})) > 0`,
    },
    {
      name: 'outbox_messages_payload_object_check',
      expression: (columns) => `jsonb_typeof(${columns.payload}) = 'object'`,
    },
    {
      name: 'outbox_messages_attempts_nonnegative_check',
      expression: (columns) => `${columns.attempts} >= 0`,
    },
    {
      name: 'outbox_messages_publication_state_check',
      expression: (columns) =>
        `${columns.publishedAt} is null or ${columns.nextAttemptAt} is null`,
    },
    {
      name: 'outbox_messages_timestamp_order_check',
      expression: (columns) =>
        `(${columns.nextAttemptAt} is null or ` +
        `${columns.nextAttemptAt} >= ${columns.occurredAt}) and ` +
        `(${columns.publishedAt} is null or ` +
        `${columns.publishedAt} >= ${columns.occurredAt})`,
    },
  ],
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
