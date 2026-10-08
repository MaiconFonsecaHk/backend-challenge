import { defineEntity, p } from '@mikro-orm/postgresql';

const WalletPersistenceSchema = defineEntity({
  name: 'WalletPersistenceEntity',
  tableName: 'wallets',
  checks: [
    {
      name: 'wallets_balance_nonnegative_check',
      expression: (columns) => `${columns.balance} >= 0`,
    },
    {
      name: 'wallets_balance_scale_check',
      expression: (columns) => `${columns.balance} = trunc(${columns.balance}, 2)`,
    },
    {
      name: 'wallets_currency_format_check',
      expression: (columns) => `${columns.currency} ~ '^[A-Z]{3}$'`,
    },
    {
      name: 'wallets_version_positive_check',
      expression: (columns) => `${columns.version} >= 1`,
    },
    {
      name: 'wallets_timestamp_order_check',
      expression: (columns) => `${columns.updatedAt} >= ${columns.createdAt}`,
    },
  ],
  properties: {
    id: p.uuid().primary(),
    playerId: p.uuid().fieldName('player_id'),
    currency: p.string().columnType('char(3)'),
    balance: p.decimal('string').columnType('numeric'),
    version: p.integer(),
    createdAt: p.datetime().columnType('timestamptz').fieldName('created_at'),
    updatedAt: p.datetime().columnType('timestamptz').fieldName('updated_at'),
  },
  triggers: [
    {
      name: 'wallets_protect_identity_and_version',
      timing: 'before',
      events: ['update'],
      body: `
        if new.id is distinct from old.id
          or new.player_id is distinct from old.player_id
          or new.currency is distinct from old.currency
          or new.created_at is distinct from old.created_at then
          raise exception 'wallet identity is immutable' using errcode = '55000';
        end if;

        if new.balance is distinct from old.balance then
          if new.version <> old.version + 1 then
            raise exception 'wallet version must increment exactly once with balance' using errcode = '23514';
          end if;
        elsif new.version is distinct from old.version then
          raise exception 'wallet version cannot change without balance' using errcode = '23514';
        end if;

        return new;
      `,
    },
  ],
  uniques: [
    {
      name: 'wallets_player_id_currency_unique',
      properties: ['playerId', 'currency'],
    },
  ],
});

export class WalletPersistenceEntity extends WalletPersistenceSchema.class {}

WalletPersistenceSchema.setClass(WalletPersistenceEntity);
