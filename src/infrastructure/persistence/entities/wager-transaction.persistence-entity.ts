import { defineEntity, p } from '@mikro-orm/postgresql';

import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';
import { WalletPersistenceEntity } from './wallet.persistence-entity.js';

const WagerTransactionPersistenceSchema = defineEntity({
  name: 'WagerTransactionPersistenceEntity',
  tableName: 'wager_transactions',
  properties: {
    id: p.uuid().primary(),
    providerId: p.text().fieldName('provider_id'),
    externalTransactionId: p.text().fieldName('external_transaction_id'),
    idempotencyKey: p.text().fieldName('idempotency_key'),
    payloadHash: p.text().fieldName('payload_hash'),
    walletId: () =>
      p
        .manyToOne(WalletPersistenceEntity)
        .mapToPk()
        .joinColumn('wallet_id')
        .deleteRule('restrict'),
    playerId: p.uuid().fieldName('player_id'),
    roundId: p.text().fieldName('round_id'),
    gameId: p.text().fieldName('game_id'),
    kind: p.enum(() => WagerTransactionKind),
    status: p.enum(() => WagerTransactionStatus),
    amount: p.decimal('string').columnType('numeric'),
    currency: p.string().columnType('char(3)'),
    referenceExternalTransactionId: p
      .text()
      .nullable()
      .fieldName('reference_external_transaction_id'),
    referenceTransactionId: () =>
      p
        .manyToOne(WagerTransactionPersistenceEntity)
        .mapToPk()
        .nullable()
        .joinColumn('reference_transaction_id')
        .deleteRule('restrict'),
    failureCode: p.text().nullable().fieldName('failure_code'),
    processedAt: p
      .datetime()
      .columnType('timestamptz')
      .nullable()
      .fieldName('processed_at'),
    resultBalanceAmount: p
      .decimal('string')
      .columnType('numeric')
      .nullable()
      .fieldName('result_balance_amount'),
    resultBalanceCurrency: p
      .string()
      .columnType('char(3)')
      .nullable()
      .fieldName('result_balance_currency'),
    referenceAttempts: p.integer().fieldName('reference_attempts'),
    nextReferenceAttemptAt: p
      .datetime()
      .columnType('timestamptz')
      .nullable()
      .fieldName('next_reference_attempt_at'),
    createdAt: p.datetime().columnType('timestamptz').fieldName('created_at'),
  },
});

export class WagerTransactionPersistenceEntity extends WagerTransactionPersistenceSchema.class {}

WagerTransactionPersistenceSchema.setClass(WagerTransactionPersistenceEntity);
