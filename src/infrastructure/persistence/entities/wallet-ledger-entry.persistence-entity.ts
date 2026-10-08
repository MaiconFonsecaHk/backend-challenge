import { defineEntity, p } from '@mikro-orm/postgresql';

import { LedgerDirection } from '../../../domain/ledger/ledger-direction.js';
import { WagerTransactionPersistenceEntity } from './wager-transaction.persistence-entity.js';
import { WalletPersistenceEntity } from './wallet.persistence-entity.js';

const WalletLedgerEntryPersistenceSchema = defineEntity({
  name: 'WalletLedgerEntryPersistenceEntity',
  tableName: 'wallet_ledger_entries',
  checks: [
    {
      name: 'wallet_ledger_entries_amount_positive_check',
      expression: (columns) => `${columns.amount} > 0`,
    },
    {
      name: 'wallet_ledger_entries_monetary_scale_check',
      expression: (columns) =>
        `${columns.amount} = trunc(${columns.amount}, 2) and ` +
        `${columns.balanceBefore} = trunc(${columns.balanceBefore}, 2) and ` +
        `${columns.balanceAfter} = trunc(${columns.balanceAfter}, 2)`,
    },
    {
      name: 'wallet_ledger_entries_nonnegative_balances_check',
      expression: (columns) =>
        `${columns.balanceBefore} >= 0 and ${columns.balanceAfter} >= 0`,
    },
    {
      name: 'wallet_ledger_entries_currency_format_check',
      expression: (columns) => `${columns.currency} ~ '^[A-Z]{3}$'`,
    },
    {
      name: 'wallet_ledger_entries_arithmetic_check',
      expression: (columns) =>
        `(${columns.direction} = 'DEBIT' and ` +
        `${columns.balanceBefore} - ${columns.amount} = ${columns.balanceAfter}) or ` +
        `(${columns.direction} = 'CREDIT' and ` +
        `${columns.balanceBefore} + ${columns.amount} = ${columns.balanceAfter})`,
    },
  ],
  indexes: [
    {
      name: 'wallet_ledger_entries_wallet_cursor_idx',
      properties: ['walletId', 'createdAt', 'id'],
    },
  ],
  properties: {
    id: p.uuid().primary(),
    walletId: () =>
      p
        .manyToOne(WalletPersistenceEntity)
        .mapToPk()
        .joinColumn('wallet_id')
        .deleteRule('restrict'),
    transactionId: () =>
      p
        .manyToOne(WagerTransactionPersistenceEntity)
        .mapToPk()
        .joinColumn('transaction_id')
        .deleteRule('restrict'),
    direction: p.enum(() => LedgerDirection),
    amount: p.decimal('string').columnType('numeric'),
    balanceBefore: p
      .decimal('string')
      .columnType('numeric')
      .fieldName('balance_before'),
    balanceAfter: p
      .decimal('string')
      .columnType('numeric')
      .fieldName('balance_after'),
    currency: p.string().columnType('char(3)'),
    createdAt: p.datetime().columnType('timestamptz').fieldName('created_at'),
  },
  triggers: [
    {
      name: 'wallet_ledger_entries_validate_context',
      timing: 'before',
      events: ['insert'],
      body: `
        if not exists (
          select 1
          from wager_transactions wager
          where wager.id = new.transaction_id
            and wager.wallet_id = new.wallet_id
            and wager.currency = new.currency
            and wager.amount = new.amount
            and wager.status = 'PROCESSED'
            and wager.kind <> 'LOSS'
        ) then
          raise exception 'ledger transaction context does not match' using errcode = '23514';
        end if;

        return new;
      `,
    },
    {
      name: 'wallet_ledger_entries_immutable',
      timing: 'before',
      events: ['update', 'delete'],
      body: `
        raise exception 'wallet ledger entries are immutable' using errcode = '55000';
        return old;
      `,
    },
  ],
  uniques: [
    {
      name: 'wallet_ledger_entries_wallet_transaction_unique',
      properties: ['walletId', 'transactionId'],
    },
  ],
});

export class WalletLedgerEntryPersistenceEntity extends WalletLedgerEntryPersistenceSchema.class {}

WalletLedgerEntryPersistenceSchema.setClass(WalletLedgerEntryPersistenceEntity);
