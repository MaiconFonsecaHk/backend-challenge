import { defineEntity, p } from '@mikro-orm/postgresql';

const InboxMessagePersistenceSchema = defineEntity({
  name: 'InboxMessagePersistenceEntity',
  tableName: 'inbox_messages',
  checks: [
    {
      name: 'inbox_messages_identity_not_blank_check',
      expression: (columns) =>
        `length(btrim(${columns.consumerName})) > 0 and ` +
        `length(btrim(${columns.messageId})) > 0 and ` +
        `length(btrim(${columns.payloadHash})) > 0`,
    },
    {
      name: 'inbox_messages_timestamp_order_check',
      expression: (columns) =>
        `${columns.processedAt} is null or ${columns.processedAt} >= ${columns.receivedAt}`,
    },
  ],
  properties: {
    consumerName: p.text().primary().fieldName('consumer_name'),
    messageId: p.text().primary().fieldName('message_id'),
    payloadHash: p.text().fieldName('payload_hash'),
    receivedAt: p.datetime().columnType('timestamptz').fieldName('received_at'),
    processedAt: p
      .datetime()
      .columnType('timestamptz')
      .nullable()
      .fieldName('processed_at'),
  },
});

export class InboxMessagePersistenceEntity extends InboxMessagePersistenceSchema.class {}

InboxMessagePersistenceSchema.setClass(InboxMessagePersistenceEntity);
