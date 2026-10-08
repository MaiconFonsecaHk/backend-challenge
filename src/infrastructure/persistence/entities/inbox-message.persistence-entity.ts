import { defineEntity, p } from '@mikro-orm/postgresql';

const InboxMessagePersistenceSchema = defineEntity({
  name: 'InboxMessagePersistenceEntity',
  tableName: 'inbox_messages',
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
