import {
  IdempotencyConflictError,
  InboxPayloadConflictError,
} from '../errors/wager-application.error.js';
import { WalletNotFoundError } from '../errors/wallet-application.error.js';
import type { PersistenceConflictClassifier } from '../ports/persistence/persistence-conflict-classifier.js';
import type {
  PersistenceRepositories,
  WagerTransactionRecord,
} from '../ports/persistence/repositories.js';
import type { UnitOfWork } from '../ports/persistence/unit-of-work.js';
import type {
  NewWagerTransactionExecutor,
  ProcessWagerTransactionResult,
  WagerTransactionProcessingCommand,
  WagerTransactionProcessor,
} from '../ports/wager-transaction-processor.js';
import { WagerTransactionKind } from '../../domain/wagering/wager-transaction.js';
import { InboxMessage } from '../../domain/messaging/inbox-message.js';

interface PreparedInboxDelivery {
  readonly message: InboxMessage;
  readonly isNew: boolean;
}

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
      return await this.unitOfWork.execute((repositories) =>
        this.processInTransaction(command, repositories),
      );
    } catch (error) {
      const recoverableConflict =
        this.conflictClassifier.isWagerIdempotencyKeyConflict(error) ||
        this.conflictClassifier.isInboxIdentityConflict(error);
      if (!recoverableConflict) {
        throw error;
      }

      return this.unitOfWork.execute(async (repositories) => {
        const inbox = await this.prepareInbox(command, repositories);
        const winner =
          await repositories.wagerTransactions.findByIdempotencyKey(
            command.idempotencyKey,
          );
        if (winner === undefined) {
          throw error;
        }

        const result = this.resolveExisting(winner, command);
        await this.completeInbox(inbox, repositories);
        return result;
      });
    }
  }

  private async processInTransaction(
    command: WagerTransactionProcessingCommand,
    repositories: PersistenceRepositories,
  ): Promise<ProcessWagerTransactionResult> {
    const inbox = await this.prepareInbox(command, repositories);
    const existing =
      await repositories.wagerTransactions.findByIdempotencyKey(
        command.idempotencyKey,
      );
    if (inbox?.message.isProcessed() === true) {
      if (existing === undefined) {
        throw new Error(
          'A processed inbox message has no persisted wager transaction.',
        );
      }

      return this.resolveExisting(existing, command);
    }
    if (existing !== undefined) {
      const result = this.resolveExisting(existing, command);
      await this.completeInbox(inbox, repositories);
      return result;
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
    await this.completeInbox(inbox, repositories);

    return PersistentWagerTransactionProcessor.toResult(created, false);
  }

  private async prepareInbox(
    command: WagerTransactionProcessingCommand,
    repositories: PersistenceRepositories,
  ): Promise<PreparedInboxDelivery | undefined> {
    const delivery = command.delivery;
    if (delivery === undefined) {
      return undefined;
    }

    const existing = await repositories.inboxMessages.findByIdentity(
      delivery.consumerName,
      delivery.messageId,
    );
    if (existing !== undefined) {
      if (!existing.matchesPayload(delivery.payloadHash)) {
        throw new InboxPayloadConflictError();
      }

      return Object.freeze({ message: existing, isNew: false });
    }

    return Object.freeze({
      message: InboxMessage.receive(delivery),
      isNew: true,
    });
  }

  private async completeInbox(
    inbox: PreparedInboxDelivery | undefined,
    repositories: PersistenceRepositories,
  ): Promise<void> {
    if (inbox === undefined || inbox.message.isProcessed()) {
      return;
    }

    inbox.message.markProcessed(inbox.message.receivedAt);
    if (inbox.isNew) {
      await repositories.inboxMessages.add(inbox.message);
    } else {
      await repositories.inboxMessages.save(inbox.message);
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
