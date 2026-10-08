import { IdempotencyConflictError } from '../errors/wager-application.error.js';
import { WalletNotFoundError } from '../errors/wallet-application.error.js';
import type { PersistenceConflictClassifier } from '../ports/persistence/persistence-conflict-classifier.js';
import type { WagerTransactionRecord } from '../ports/persistence/repositories.js';
import type { UnitOfWork } from '../ports/persistence/unit-of-work.js';
import type {
  NewWagerTransactionExecutor,
  ProcessWagerTransactionResult,
  WagerTransactionProcessingCommand,
  WagerTransactionProcessor,
} from '../ports/wager-transaction-processor.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction.js';

export class PersistentWagerTransactionProcessor
  implements WagerTransactionProcessor
{
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly newTransactionExecutor: NewWagerTransactionExecutor,
    private readonly conflictClassifier: PersistenceConflictClassifier,
  ) {}

  async process(
    command: WagerTransactionProcessingCommand,
  ): Promise<ProcessWagerTransactionResult> {
    try {
      return await this.unitOfWork.execute(async (repositories) => {
        const existing =
          await repositories.wagerTransactions.findByIdempotencyKey(
            command.idempotencyKey,
          );
        if (existing !== undefined) {
          return this.resolveExisting(existing, command);
        }

        const wallet =
          command.kind === WagerTransactionKind.Loss
            ? await repositories.wallets.findById(command.walletId)
            : await repositories.wallets.findByIdForUpdate(command.walletId);
        if (wallet === undefined) {
          throw new WalletNotFoundError(command.walletId);
        }

        const created = await this.newTransactionExecutor.execute(
          command,
          wallet,
          repositories,
        );
        PersistentWagerTransactionProcessor.assertExecutionMatchesCommand(
          created,
          command,
        );
        await repositories.wagerTransactions.add(created);

        return PersistentWagerTransactionProcessor.toResult(created, false);
      });
    } catch (error) {
      if (!this.conflictClassifier.isWagerIdempotencyKeyConflict(error)) {
        throw error;
      }

      return this.unitOfWork.execute(async (repositories) => {
        const winner =
          await repositories.wagerTransactions.findByIdempotencyKey(
            command.idempotencyKey,
          );
        if (winner === undefined) {
          throw error;
        }

        return this.resolveExisting(winner, command);
      });
    }
  }

  private resolveExisting(
    record: WagerTransactionRecord,
    command: WagerTransactionProcessingCommand,
  ): ProcessWagerTransactionResult {
    if (!record.transaction.matchesPayload(command.payloadHash)) {
      throw new IdempotencyConflictError(command.idempotencyKey);
    }

    return PersistentWagerTransactionProcessor.toResult(record, true);
  }

  private static toResult(
    record: WagerTransactionRecord,
    idempotentReplay: boolean,
  ): ProcessWagerTransactionResult {
    const { transaction } = record;

    return Object.freeze({
      transactionId: transaction.id,
      status: transaction.status,
      ...(record.resultBalance === undefined
        ? {}
        : { balance: Object.freeze(record.resultBalance.toJSON()) }),
      ...(transaction.failureCode === undefined
        ? {}
        : { failureCode: transaction.failureCode }),
      idempotentReplay,
    });
  }

  private static assertExecutionMatchesCommand(
    record: WagerTransactionRecord,
    command: WagerTransactionProcessingCommand,
  ): void {
    const transaction = record.transaction;
    const money = transaction.money.toJSON();
    const matches =
      transaction.providerId === command.providerId &&
      transaction.externalTransactionId === command.externalTransactionId &&
      transaction.idempotencyKey === command.idempotencyKey &&
      transaction.payloadHash === command.payloadHash &&
      transaction.playerId === command.playerId &&
      transaction.walletId === command.walletId &&
      transaction.roundId === command.roundId &&
      transaction.gameId === command.gameId &&
      transaction.kind === command.kind &&
      money.amount === command.money.amount &&
      money.currency === command.money.currency &&
      transaction.referenceExternalTransactionId ===
        command.referenceExternalTransactionId;

    if (!matches) {
      throw new Error(
        'New wager execution returned a transaction that does not match its command.',
      );
    }
  }
}
