import { defineEntity, p } from '@mikro-orm/postgresql';

const WalletPersistenceSchema = defineEntity({
  name: 'WalletPersistenceEntity',
  tableName: 'wallets',
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid().fieldName('player_id'),
    currency: p.string().columnType('char(3)'),
    balance: p.decimal('string').columnType('numeric'),
    version: p.integer(),
    createdAt: p.datetime().columnType('timestamptz').fieldName('created_at'),
    updatedAt: p.datetime().columnType('timestamptz').fieldName('updated_at'),
  },
});

export class WalletPersistenceEntity extends WalletPersistenceSchema.class {}

WalletPersistenceSchema.setClass(WalletPersistenceEntity);
