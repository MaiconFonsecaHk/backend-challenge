import type { WagerTransactionRecord } from '../../../application/ports/persistence/repositories.js';
import {
  WagerTransaction,
  type WagerTransactionKind,
  type WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';
import type { WagerTransactionPersistenceEntity } from '../entities/wager-transaction.persistence-entity.js';
import {
  moneyFromPersistence,
  moneyToPersistence,
} from './money.persistence-mapper.js';

export interface WagerTransactionPersistenceState {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly status: WagerTransactionStatus;
  readonly amount: string;
  readonly currency: string;
  readonly referenceExternalTransactionId: string | null;
  readonly referenceTransactionId: string | null;
  readonly failureCode: string | null;
  readonly processedAt: Date | null;
  readonly resultBalanceAmount: string | null;
  readonly resultBalanceCurrency: string | null;
  readonly referenceAttempts: number;
  readonly nextReferenceAttemptAt: Date | null;
  readonly createdAt: Date;
}

export class WagerTransactionPersistenceMapper {
  static toRecord(
    entity: WagerTransactionPersistenceEntity,
  ): WagerTransactionRecord {
    const transaction = WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: moneyFromPersistence(entity.amount, entity.currency),
      referenceExternalTransactionId:
        entity.referenceExternalTransactionId ?? undefined,
      createdAt: entity.createdAt,
      status: entity.status,
      referenceTransactionId: entity.referenceTransactionId ?? undefined,
      failureCode: entity.failureCode ?? undefined,
      processedAt: entity.processedAt ?? undefined,
    });

    const resultBalanceAmount = entity.resultBalanceAmount;
    const resultBalanceCurrency = entity.resultBalanceCurrency;
    const resultBalance =
      resultBalanceAmount == null || resultBalanceCurrency == null
        ? undefined
        : moneyFromPersistence(
            resultBalanceAmount,
            resultBalanceCurrency,
          );
    const nextReferenceAttemptAt = entity.nextReferenceAttemptAt;

    return Object.freeze({
      transaction,
      resultBalance,
      referenceAttempts: entity.referenceAttempts,
      nextReferenceAttemptAt:
        nextReferenceAttemptAt == null
          ? undefined
          : new Date(nextReferenceAttemptAt.getTime()),
    });
  }

  static toPersistence(
    record: WagerTransactionRecord,
  ): WagerTransactionPersistenceState {
    const { transaction } = record;
    const money = moneyToPersistence(transaction.money);
    const resultBalance =
      record.resultBalance === undefined
        ? undefined
        : moneyToPersistence(record.resultBalance);

    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      idempotencyKey: transaction.idempotencyKey,
      payloadHash: transaction.payloadHash,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      status: transaction.status,
      amount: money.amount,
      currency: money.currency,
      referenceExternalTransactionId:
        transaction.referenceExternalTransactionId ?? null,
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      failureCode: transaction.failureCode ?? null,
      processedAt: transaction.processedAt ?? null,
      resultBalanceAmount: resultBalance?.amount ?? null,
      resultBalanceCurrency: resultBalance?.currency ?? null,
      referenceAttempts: record.referenceAttempts,
      nextReferenceAttemptAt:
        record.nextReferenceAttemptAt === undefined
          ? null
          : new Date(record.nextReferenceAttemptAt.getTime()),
      createdAt: transaction.createdAt,
    };
  }
}
