import { defineEntity, p } from '@mikro-orm/postgresql';

import { LedgerDirection } from '../../../domain/ledger/ledger-direction.js';
import { WagerTransactionPersistenceEntity } from './wager-transaction.persistence-entity.js';
import { WalletPersistenceEntity } from './wallet.persistence-entity.js';

const WalletLedgerEntryPersistenceSchema = defineEntity({
  name: 'WalletLedgerEntryPersistenceEntity',
  tableName: 'wallet_ledger_entries',
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
});

export class WalletLedgerEntryPersistenceEntity extends WalletLedgerEntryPersistenceSchema.class {}

WalletLedgerEntryPersistenceSchema.setClass(WalletLedgerEntryPersistenceEntity);
