import type { Clock } from '../../ports/clock.js';
import type { IdGenerator } from '../../ports/id-generator.js';
import type { PersistenceRepositories } from '../../ports/persistence/repositories.js';
import type { UnitOfWork } from '../../ports/persistence/unit-of-work.js';
import type { WalletPersistenceConflictClassifier } from '../../ports/persistence/wallet-persistence-conflict-classifier.js';
import {
  InvalidCorrelationIdError,
  WalletAlreadyExistsError,
} from '../../errors/wallet-application.error.js';
import { WalletBalanceChanged } from '../../../domain/events/wallet-balance-changed.event.js';
import { LedgerDirection } from '../../../domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.js';
import { OutboxMessage } from '../../../domain/messaging/outbox-message.js';
import {
  Money,
  type MoneyProps,
} from '../../../domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../../domain/wagering/wager-transaction.js';
import { Wallet } from '../../../domain/wallet/wallet.js';

const INTERNAL_PROVIDER_ID = 'internal-wallet-service';
const OPENING_GAME_ID = 'wallet-opening';

export interface CreateWalletCommand {
  readonly playerId: string;
  readonly initialBalance: MoneyProps;
  readonly correlationId: string;
}

export interface CreateWalletResult {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
}

export class CreateWalletUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly conflictClassifier: WalletPersistenceConflictClassifier,
  ) {}

  async execute(command: CreateWalletCommand): Promise<CreateWalletResult> {
    if (command.correlationId.trim().length === 0) {
      throw new InvalidCorrelationIdError();
    }

    const initialBalance = Money.from(command.initialBalance);

    try {
      return await this.unitOfWork.execute(async (repositories) => {
        const existingWallet =
          await repositories.wallets.findByPlayerAndCurrency(
            command.playerId,
            initialBalance.currency,
          );

        if (existingWallet !== undefined) {
          throw new WalletAlreadyExistsError(
            command.playerId,
            initialBalance.currency,
          );
        }

        const occurredAt = this.clock.now();
        const wallet = Wallet.open({
          id: this.idGenerator.generate(),
          playerId: command.playerId,
          initialBalance,
          openedAt: occurredAt,
        });

        if (initialBalance.isPositive()) {
          await this.addOpeningRecords(
            wallet,
            command.correlationId,
            occurredAt,
            repositories,
          );
        } else {
          await repositories.wallets.add(wallet);
        }

        return Object.freeze({
          id: wallet.id,
          playerId: wallet.playerId,
          balance: wallet.balance.toJSON(),
          version: wallet.version,
        });
      });
    } catch (error) {
      if (this.conflictClassifier.isWalletIdentityConflict(error)) {
        throw new WalletAlreadyExistsError(
          command.playerId,
          initialBalance.currency,
        );
      }

      throw error;
    }
  }

  private async addOpeningRecords(
    wallet: Wallet,
    correlationId: string,
    occurredAt: Date,
    repositories: PersistenceRepositories,
  ): Promise<void> {
    const openingTransactionId = this.idGenerator.generate();
    const openingIdentity = `opening:${wallet.id}`;
    const opening = WagerTransaction.create({
      id: openingTransactionId,
      providerId: INTERNAL_PROVIDER_ID,
      externalTransactionId: openingIdentity,
      idempotencyKey: openingIdentity,
      payloadHash: openingIdentity,
      walletId: wallet.id,
      playerId: wallet.playerId,
      roundId: openingIdentity,
      gameId: OPENING_GAME_ID,
      kind: WagerTransactionKind.Opening,
      money: wallet.balance,
      createdAt: occurredAt,
    });
    opening.markProcessed(undefined, occurredAt);

    const ledgerEntry = WalletLedgerEntry.create({
      id: this.idGenerator.generate(),
      walletId: wallet.id,
      transactionId: opening.id,
      direction: LedgerDirection.Credit,
      money: wallet.balance,
      balanceBefore: Money.zero(wallet.currency),
      balanceAfter: wallet.balance,
      createdAt: occurredAt,
    });
    const balanceChanged = WalletBalanceChanged.from(wallet, ledgerEntry, {
      eventId: this.idGenerator.generate(),
      correlationId,
      causationId: opening.id,
      occurredAt,
    });
    const outboxMessage = OutboxMessage.enqueue(balanceChanged);

    await repositories.wallets.add(wallet);
    await repositories.wagerTransactions.add({
      transaction: opening,
      resultBalance: wallet.balance,
      referenceAttempts: 0,
    });
    await repositories.walletLedgerEntries.add(ledgerEntry);
    await repositories.outboxMessages.add(outboxMessage);
  }
}
