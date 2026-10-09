import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type {
  PersistenceRepositories,
  WagerTransactionRecord,
} from '../ports/persistence/repositories.js';
import type {
  NewWagerTransactionExecutor,
  WagerTransactionProcessingCommand,
} from '../ports/wager-transaction-processor.js';
import { PendingReferenceRetryPolicy } from './pending-reference-retry.policy.js';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '../../domain/events/wager-transaction.events.js';
import { WalletBalanceChanged } from '../../domain/events/wallet-balance-changed.event.js';
import { LedgerDirection } from '../../domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../domain/ledger/wallet-ledger-entry.js';
import { OutboxMessage } from '../../domain/messaging/outbox-message.js';
import { Money } from '../../domain/shared/value-objects/money.js';
import { InvalidTransactionReferenceError } from '../../domain/wagering/wager-transaction.error.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction.js';
import { InsufficientFundsError } from '../../domain/wallet/wallet.error.js';
import type { Wallet, WalletBalanceChange } from '../../domain/wallet/wallet.js';

export const WAGER_FAILURE_CODES = Object.freeze({
  insufficientFunds: 'INSUFFICIENT_FUNDS',
  invalidReference: 'INVALID_TRANSACTION_REFERENCE',
  referenceNotFound: 'REFERENCE_NOT_FOUND',
  referenceAlreadyReversed: 'REFERENCE_ALREADY_REVERSED',
  reversalInsufficientFunds: 'REVERSAL_INSUFFICIENT_FUNDS',
} as const);

export class WagerTransactionExecutor implements NewWagerTransactionExecutor {
  constructor(
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly pendingReferenceRetryPolicy: PendingReferenceRetryPolicy,
  ) {}

  async execute(
    command: WagerTransactionProcessingCommand,
    wallet: Wallet,
    repositories: PersistenceRepositories,
  ): Promise<WagerTransactionRecord> {
    const occurredAt = this.clock.now();
    const transaction = WagerTransaction.create({
      id: this.idGenerator.generate(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash: command.payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: Money.from(command.money),
      referenceExternalTransactionId: command.referenceExternalTransactionId,
      createdAt: occurredAt,
    });

    const reference = await this.resolveReference(transaction, repositories);
    if (this.referenceCanStillBecomeProcessable(transaction, reference)) {
      transaction.markPendingReference();
      const retry = this.requireNextReferenceRetry(transaction, 0, occurredAt);
      await this.enqueueTransactionEvent(
        transaction,
        command.correlationId,
        occurredAt,
        repositories,
      );

      return this.record(
        transaction,
        wallet,
        retry.attempts,
        retry.nextAttemptAt,
      );
    }

    return this.processResolvedTransaction(
      transaction,
      wallet,
      reference,
      repositories,
      occurredAt,
      command.correlationId,
      0,
    );
  }

  async resumePendingReference(
    record: WagerTransactionRecord,
    wallet: Wallet,
    repositories: PersistenceRepositories,
  ): Promise<WagerTransactionRecord> {
    const { transaction } = record;
    if (transaction.status !== WagerTransactionStatus.PendingReference) {
      throw new Error('Only a pending-reference transaction can be resumed.');
    }

    const attemptedAt = this.clock.now();
    const reference = await this.resolveReference(transaction, repositories);
    if (this.referenceCanStillBecomeProcessable(transaction, reference)) {
      const retry = this.pendingReferenceRetryPolicy.nextRetry(
        record.referenceAttempts,
        transaction.createdAt,
        attemptedAt,
      );
      if (retry !== undefined) {
        return this.record(
          transaction,
          wallet,
          retry.attempts,
          retry.nextAttemptAt,
        );
      }

      transaction.reject(WAGER_FAILURE_CODES.referenceNotFound, attemptedAt);
      await this.enqueueTransactionEvent(
        transaction,
        transaction.id,
        attemptedAt,
        repositories,
      );
      return this.record(
        transaction,
        wallet,
        record.referenceAttempts + 1,
      );
    }

    return this.processResolvedTransaction(
      transaction,
      wallet,
      reference,
      repositories,
      attemptedAt,
      transaction.id,
      record.referenceAttempts,
    );
  }

  private async processResolvedTransaction(
    transaction: WagerTransaction,
    wallet: Wallet,
    reference: WagerTransactionRecord | undefined,
    repositories: PersistenceRepositories,
    occurredAt: Date,
    correlationId: string,
    referenceAttempts: number,
  ): Promise<WagerTransactionRecord> {

    if (transaction.kind === WagerTransactionKind.Loss) {
      transaction.markProcessed(undefined, occurredAt);
      await this.enqueueTransactionEvent(
        transaction,
        correlationId,
        occurredAt,
        repositories,
      );

      return this.record(transaction, wallet, referenceAttempts);
    }

    let direction: LedgerDirection;
    try {
      direction = transaction.ledgerDirectionFor(reference?.transaction);
    } catch (error) {
      if (!(error instanceof InvalidTransactionReferenceError)) {
        throw error;
      }

      transaction.reject(WAGER_FAILURE_CODES.invalidReference, occurredAt);
      await this.enqueueTransactionEvent(
        transaction,
        correlationId,
        occurredAt,
        repositories,
      );

      return this.record(transaction, wallet, referenceAttempts);
    }

    if (transaction.requiresReference() && reference !== undefined) {
      const existingReversal =
        await repositories.wagerTransactions.findByReferenceAndKind(
          reference.transaction.id,
          transaction.kind,
      );
      if (existingReversal !== undefined) {
        transaction.reject(
          WAGER_FAILURE_CODES.referenceAlreadyReversed,
          occurredAt,
        );
        await this.enqueueTransactionEvent(
          transaction,
          correlationId,
          occurredAt,
          repositories,
        );

        return this.record(transaction, wallet, referenceAttempts);
      }
    }

    let balanceChange: WalletBalanceChange;
    try {
      balanceChange =
        direction === LedgerDirection.Debit
          ? wallet.debit(transaction.money, occurredAt)
          : wallet.credit(transaction.money, occurredAt);
    } catch (error) {
      if (!(error instanceof InsufficientFundsError)) {
        throw error;
      }

      const failureCode =
        transaction.kind === WagerTransactionKind.Bet
          ? WAGER_FAILURE_CODES.insufficientFunds
          : WAGER_FAILURE_CODES.reversalInsufficientFunds;
      transaction.reject(failureCode, occurredAt);
      await this.enqueueTransactionEvent(
        transaction,
        correlationId,
        occurredAt,
        repositories,
      );

      return this.record(transaction, wallet, referenceAttempts);
    }

    transaction.markProcessed(reference?.transaction.id, occurredAt);
    const ledgerEntry = WalletLedgerEntry.create({
      id: this.idGenerator.generate(),
      walletId: wallet.id,
      transactionId: transaction.id,
      direction: balanceChange.direction,
      money: balanceChange.money,
      balanceBefore: balanceChange.balanceBefore,
      balanceAfter: balanceChange.balanceAfter,
      createdAt: occurredAt,
    });

    await repositories.wallets.save(wallet);
    await repositories.walletLedgerEntries.add(ledgerEntry);
    await this.enqueueTransactionEvent(
      transaction,
      correlationId,
      occurredAt,
      repositories,
    );
    await this.enqueueBalanceEvent(
      transaction,
      wallet,
      ledgerEntry,
      correlationId,
      occurredAt,
      repositories,
    );

    return this.record(transaction, wallet, referenceAttempts);
  }

  private referenceCanStillBecomeProcessable(
    transaction: WagerTransaction,
    reference: WagerTransactionRecord | undefined,
  ): boolean {
    return (
      transaction.referenceExternalTransactionId !== undefined &&
      (reference === undefined || !reference.transaction.isTerminal())
    );
  }

  private requireNextReferenceRetry(
    transaction: WagerTransaction,
    currentAttempts: number,
    attemptedAt: Date,
  ) {
    const retry = this.pendingReferenceRetryPolicy.nextRetry(
      currentAttempts,
      transaction.createdAt,
      attemptedAt,
    );
    if (retry === undefined) {
      throw new Error('A new pending reference cannot already be expired.');
    }

    return retry;
  }

  private async resolveReference(
    transaction: WagerTransaction,
    repositories: PersistenceRepositories,
  ): Promise<WagerTransactionRecord | undefined> {
    if (transaction.referenceExternalTransactionId === undefined) {
      return undefined;
    }

    return repositories.wagerTransactions.findByProviderTransaction(
      transaction.providerId,
      transaction.referenceExternalTransactionId,
    );
  }

  private async enqueueTransactionEvent(
    transaction: WagerTransaction,
    correlationId: string,
    occurredAt: Date,
    repositories: PersistenceRepositories,
  ): Promise<void> {
    const context = {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId: transaction.id,
      occurredAt,
    };
    if (!transaction.isTerminal()) {
      await repositories.outboxMessages.add(
        OutboxMessage.enqueue(
          WagerTransactionPendingReference.from(transaction, context),
        ),
      );
      return;
    }

    if (transaction.failureCode === undefined) {
      await repositories.outboxMessages.add(
        OutboxMessage.enqueue(
          WagerTransactionProcessed.from(transaction, context),
        ),
      );
      return;
    }

    await repositories.outboxMessages.add(
      OutboxMessage.enqueue(
        WagerTransactionRejected.from(transaction, context),
      ),
    );
  }

  private async enqueueBalanceEvent(
    transaction: WagerTransaction,
    wallet: Wallet,
    ledgerEntry: WalletLedgerEntry,
    correlationId: string,
    occurredAt: Date,
    repositories: PersistenceRepositories,
  ): Promise<void> {
    const event = WalletBalanceChanged.from(wallet, ledgerEntry, {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId: transaction.id,
      occurredAt,
    });

    await repositories.outboxMessages.add(OutboxMessage.enqueue(event));
  }

  private record(
    transaction: WagerTransaction,
    wallet: Wallet,
    referenceAttempts: number,
    nextReferenceAttemptAt?: Date,
  ): WagerTransactionRecord {
    return Object.freeze({
      transaction,
      resultBalance: wallet.balance,
      referenceAttempts,
      ...(nextReferenceAttemptAt === undefined
        ? {}
        : { nextReferenceAttemptAt }),
    });
  }
}
