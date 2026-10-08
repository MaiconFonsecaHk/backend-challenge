import { defineEntity, p } from '@mikro-orm/postgresql';

import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';
import { WalletPersistenceEntity } from './wallet.persistence-entity.js';

const WagerTransactionPersistenceSchema = defineEntity({
  name: 'WagerTransactionPersistenceEntity',
  tableName: 'wager_transactions',
  checks: [
    {
      name: 'wager_transactions_identity_not_blank_check',
      expression: (columns) =>
        `length(btrim(${columns.providerId})) > 0 and ` +
        `length(btrim(${columns.externalTransactionId})) > 0 and ` +
        `length(btrim(${columns.idempotencyKey})) > 0 and ` +
        `length(btrim(${columns.payloadHash})) > 0 and ` +
        `length(btrim(${columns.roundId})) > 0 and ` +
        `length(btrim(${columns.gameId})) > 0`,
    },
    {
      name: 'wager_transactions_amount_positive_check',
      expression: (columns) => `${columns.amount} > 0`,
    },
    {
      name: 'wager_transactions_amount_scale_check',
      expression: (columns) => `${columns.amount} = trunc(${columns.amount}, 2)`,
    },
    {
      name: 'wager_transactions_currency_format_check',
      expression: (columns) => `${columns.currency} ~ '^[A-Z]{3}$'`,
    },
    {
      name: 'wager_transactions_reference_attempts_check',
      expression: (columns) => `${columns.referenceAttempts} >= 0`,
    },
    {
      name: 'wager_transactions_external_reference_check',
      expression: (columns) =>
        `(${columns.kind} in ('REFUND', 'ROLLBACK') and ` +
        `${columns.referenceExternalTransactionId} is not null) or ` +
        `(${columns.kind} in ('OPENING', 'BET', 'LOSS') and ` +
        `${columns.referenceExternalTransactionId} is null) or ` +
        `${columns.kind} = 'WIN'`,
    },
    {
      name: 'wager_transactions_reference_not_blank_check',
      expression: (columns) =>
        `${columns.referenceExternalTransactionId} is null or ` +
        `length(btrim(${columns.referenceExternalTransactionId})) > 0`,
    },
    {
      name: 'wager_transactions_resolved_reference_check',
      expression: (columns) =>
        `(${columns.referenceTransactionId} is null or ` +
        `${columns.referenceExternalTransactionId} is not null) and ` +
        `(${columns.referenceTransactionId} is null or ` +
        `${columns.referenceTransactionId} <> ${columns.id}) and ` +
        `(${columns.status} <> 'PENDING_REFERENCE' or ` +
        `(${columns.referenceExternalTransactionId} is not null and ` +
        `${columns.referenceTransactionId} is null)) and ` +
        `(${columns.status} <> 'PROCESSED' or ` +
        `${columns.referenceExternalTransactionId} is null or ` +
        `${columns.referenceTransactionId} is not null)`,
    },
    {
      name: 'wager_transactions_terminal_timestamp_check',
      expression: (columns) =>
        `(${columns.status} in ('PROCESSED', 'REJECTED', 'FAILED') and ` +
        `${columns.processedAt} is not null) or ` +
        `(${columns.status} in ('PENDING', 'PENDING_REFERENCE') and ` +
        `${columns.processedAt} is null)`,
    },
    {
      name: 'wager_transactions_failure_code_check',
      expression: (columns) =>
        `(${columns.status} in ('REJECTED', 'FAILED') and ` +
        `${columns.failureCode} is not null and ` +
        `${columns.failureCode} ~ '^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$') or ` +
        `(${columns.status} not in ('REJECTED', 'FAILED') and ` +
        `${columns.failureCode} is null)`,
    },
    {
      name: 'wager_transactions_result_balance_pair_check',
      expression: (columns) =>
        `(${columns.resultBalanceAmount} is null) = ` +
        `(${columns.resultBalanceCurrency} is null)`,
    },
    {
      name: 'wager_transactions_result_balance_value_check',
      expression: (columns) =>
        `${columns.resultBalanceAmount} is null or ` +
        `(${columns.resultBalanceAmount} >= 0 and ` +
        `${columns.resultBalanceAmount} = trunc(${columns.resultBalanceAmount}, 2))`,
    },
    {
      name: 'wager_transactions_result_currency_format_check',
      expression: (columns) =>
        `${columns.resultBalanceCurrency} is null or ` +
        `(${columns.resultBalanceCurrency} ~ '^[A-Z]{3}$' and ` +
        `${columns.resultBalanceCurrency} = ${columns.currency})`,
    },
    {
      name: 'wager_transactions_retry_state_check',
      expression: (columns) =>
        `${columns.nextReferenceAttemptAt} is null or ` +
        `${columns.status} = 'PENDING_REFERENCE'`,
    },
    {
      name: 'wager_transactions_timestamp_order_check',
      expression: (columns) =>
        `${columns.processedAt} is null or ${columns.processedAt} >= ${columns.createdAt}`,
    },
  ],
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
  triggers: [
    {
      name: 'wager_transactions_validate_context',
      timing: 'before',
      events: ['insert', 'update'],
      body: `
        if tg_op = 'UPDATE' then
          if old.status in ('PROCESSED', 'REJECTED', 'FAILED') and new is distinct from old then
            raise exception 'terminal wager transactions are immutable' using errcode = '55000';
          end if;

          if new.id is distinct from old.id
            or new.provider_id is distinct from old.provider_id
            or new.external_transaction_id is distinct from old.external_transaction_id
            or new.idempotency_key is distinct from old.idempotency_key
            or new.payload_hash is distinct from old.payload_hash
            or new.wallet_id is distinct from old.wallet_id
            or new.player_id is distinct from old.player_id
            or new.round_id is distinct from old.round_id
            or new.game_id is distinct from old.game_id
            or new.kind is distinct from old.kind
            or new.amount is distinct from old.amount
            or new.currency is distinct from old.currency
            or new.reference_external_transaction_id is distinct from old.reference_external_transaction_id
            or new.created_at is distinct from old.created_at then
            raise exception 'wager transaction identity is immutable' using errcode = '55000';
          end if;
        end if;

        if not exists (
          select 1
          from wallets wallet
          where wallet.id = new.wallet_id
            and wallet.player_id = new.player_id
            and wallet.currency = new.currency
        ) then
          raise exception 'wager transaction wallet context does not match' using errcode = '23514';
        end if;

        if new.reference_transaction_id is not null and not exists (
          select 1
          from wager_transactions referenced
          where referenced.id = new.reference_transaction_id
            and referenced.external_transaction_id = new.reference_external_transaction_id
            and referenced.provider_id = new.provider_id
            and referenced.player_id = new.player_id
            and referenced.wallet_id = new.wallet_id
            and referenced.currency = new.currency
            and referenced.round_id = new.round_id
            and referenced.status = 'PROCESSED'
            and (
              (new.kind = 'WIN' and referenced.kind = 'BET')
              or (new.kind = 'REFUND' and referenced.kind = 'BET' and new.amount = referenced.amount)
              or (new.kind = 'ROLLBACK' and referenced.kind in ('BET', 'WIN', 'REFUND') and new.amount = referenced.amount)
            )
        ) then
          raise exception 'wager transaction reference context does not match' using errcode = '23514';
        end if;

        return new;
      `,
    },
  ],
  uniques: [
    {
      name: 'wager_transactions_idempotency_key_unique',
      properties: 'idempotencyKey',
    },
    {
      name: 'wager_transactions_provider_external_unique',
      properties: ['providerId', 'externalTransactionId'],
    },
    {
      name: 'wager_transactions_reference_kind_unique',
      properties: ['referenceTransactionId', 'kind'],
      where: `kind in ('REFUND', 'ROLLBACK') and reference_transaction_id is not null`,
    },
  ],
});

export class WagerTransactionPersistenceEntity extends WagerTransactionPersistenceSchema.class {}

WagerTransactionPersistenceSchema.setClass(WagerTransactionPersistenceEntity);
