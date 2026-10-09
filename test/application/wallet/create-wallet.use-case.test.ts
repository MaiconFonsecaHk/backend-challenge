import { describe, expect, test } from 'bun:test';

import type { Clock } from '../../../src/application/ports/clock.js';
import type { IdGenerator } from '../../../src/application/ports/id-generator.js';
import type { PersistenceRepositories } from '../../../src/application/ports/persistence/repositories.js';
import type { UnitOfWork } from '../../../src/application/ports/persistence/unit-of-work.js';
import {
  InvalidCorrelationIdError,
  WalletAlreadyExistsError,
} from '../../../src/application/errors/wallet-application.error.js';
import { CreateWalletUseCase } from '../../../src/application/use-cases/wallet/create-wallet.use-case.js';
import type { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';
import type { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';
import type { WagerTransactionRecord } from '../../../src/application/ports/persistence/repositories.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';

const NOW = new Date('2026-10-08T15:00:00.000Z');
const IDS = {
  wallet: '10000000-0000-4000-8000-000000000201',
  opening: '30000000-0000-4000-8000-000000000201',
  ledger: '40000000-0000-4000-8000-000000000201',
  event: '50000000-0000-4000-8000-000000000201',
} as const;

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW.getTime());
  }
}

class SequenceIdGenerator implements IdGenerator {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  generate(): string {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error('Test id sequence exhausted');
    }

    this.index += 1;
    return value;
  }

  get generatedCount(): number {
    return this.index;
  }
}

interface PersistenceCapture {
  readonly wallets: Wallet[];
  readonly wagerTransactions: WagerTransactionRecord[];
  readonly ledgerEntries: WalletLedgerEntry[];
  readonly outboxMessages: OutboxMessage[];
}

function persistenceDouble(existingWallet?: Wallet): {
  readonly unitOfWork: UnitOfWork;
  readonly capture: PersistenceCapture;
} {
  const capture: PersistenceCapture = {
    wallets: [],
    wagerTransactions: [],
    ledgerEntries: [],
    outboxMessages: [],
  };
  const repositories: PersistenceRepositories = {
    wallets: {
      findById: async () => undefined,
      findByIdForUpdate: async () => undefined,
      findByPlayerAndCurrency: async () => existingWallet,
      add: async (wallet) => {
        capture.wallets.push(wallet);
      },
      save: async () => undefined,
    },
    walletReconciliations: {
      findByWalletId: async () => undefined,
    },
    wagerTransactions: {
      findById: async () => undefined,
      findByIdempotencyKey: async () => undefined,
      findByProviderTransaction: async () => undefined,
      findByReferenceAndKind: async () => undefined,
      add: async (record) => {
        capture.wagerTransactions.push(record);
      },
      save: async () => undefined,
    },
    walletLedgerEntries: {
      findByWalletAndTransaction: async () => undefined,
      listByWallet: async () => [],
      add: async (entry) => {
        capture.ledgerEntries.push(entry);
      },
    },
    inboxMessages: {
      findByIdentity: async () => undefined,
      add: async () => undefined,
      save: async () => undefined,
    },
    outboxMessages: {
      findById: async () => undefined,
      findDueForUpdate: async () => [],
      add: async (message) => {
        capture.outboxMessages.push(message);
      },
      save: async () => undefined,
    },
  };

  return {
    capture,
    unitOfWork: {
      execute: async <T>(work: (context: PersistenceRepositories) => Promise<T>) =>
        work(repositories),
    },
  };
}

describe('CreateWalletUseCase', () => {
  test('creates positive opening balance, internal transaction, ledger, and outbox atomically', async () => {
    const { capture, unitOfWork } = persistenceDouble();
    const idGenerator = new SequenceIdGenerator(Object.values(IDS));
    const useCase = new CreateWalletUseCase(
      unitOfWork,
      idGenerator,
      new FixedClock(),
    );

    const result = await useCase.execute({
      playerId: '20000000-0000-4000-8000-000000000201',
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'request-201',
    });

    expect(result).toEqual({
      id: IDS.wallet,
      playerId: '20000000-0000-4000-8000-000000000201',
      balance: { amount: '100.00', currency: 'BRL' },
      version: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(capture.wallets).toHaveLength(1);
    expect(capture.wagerTransactions).toHaveLength(1);
    expect(capture.ledgerEntries).toHaveLength(1);
    expect(capture.outboxMessages).toHaveLength(1);

    const opening = capture.wagerTransactions[0];
    expect(opening?.transaction.kind).toBe(WagerTransactionKind.Opening);
    expect(opening?.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(opening?.resultBalance?.toJSON()).toEqual({
      amount: '100.00',
      currency: 'BRL',
    });
    expect(capture.ledgerEntries[0]?.balanceBefore.toJSON().amount).toBe('0.00');
    expect(capture.ledgerEntries[0]?.balanceAfter.toJSON().amount).toBe('100.00');
    expect(capture.outboxMessages[0]?.eventType).toBe('WalletBalanceChanged');
    expect(capture.outboxMessages[0]?.payload).toEqual(
      expect.objectContaining({
        correlationId: 'request-201',
        causationId: IDS.opening,
        eventId: IDS.event,
      }),
    );
    expect(idGenerator.generatedCount).toBe(4);
  });

  test('creates a zero-balance wallet without inventing a financial movement', async () => {
    const { capture, unitOfWork } = persistenceDouble();
    const idGenerator = new SequenceIdGenerator([IDS.wallet]);
    const useCase = new CreateWalletUseCase(
      unitOfWork,
      idGenerator,
      new FixedClock(),
    );

    const result = await useCase.execute({
      playerId: '20000000-0000-4000-8000-000000000201',
      initialBalance: { amount: '0.00', currency: 'BRL' },
      correlationId: 'request-201',
    });

    expect(result.balance.amount).toBe('0.00');
    expect(capture.wallets).toHaveLength(1);
    expect(capture.wagerTransactions).toEqual([]);
    expect(capture.ledgerEntries).toEqual([]);
    expect(capture.outboxMessages).toEqual([]);
    expect(idGenerator.generatedCount).toBe(1);
  });

  test('rejects a duplicate player and currency before creating any records', async () => {
    const existingWallet = Wallet.open({
      id: IDS.wallet,
      playerId: '20000000-0000-4000-8000-000000000201',
      initialBalance: Money.zero('BRL'),
      openedAt: NOW,
    });
    const { capture, unitOfWork } = persistenceDouble(existingWallet);
    const idGenerator = new SequenceIdGenerator([]);
    const useCase = new CreateWalletUseCase(
      unitOfWork,
      idGenerator,
      new FixedClock(),
    );

    await expect(
      useCase.execute({
        playerId: existingWallet.playerId,
        initialBalance: { amount: '10.00', currency: 'BRL' },
        correlationId: 'request-duplicate',
      }),
    ).rejects.toBeInstanceOf(WalletAlreadyExistsError);
    expect(capture.wallets).toEqual([]);
    expect(capture.wagerTransactions).toEqual([]);
    expect(capture.ledgerEntries).toEqual([]);
    expect(capture.outboxMessages).toEqual([]);
    expect(idGenerator.generatedCount).toBe(0);
  });

  test('requires correlation before opening the transaction boundary', async () => {
    const { unitOfWork } = persistenceDouble();
    let unitOfWorkCalls = 0;
    const guardedUnitOfWork: UnitOfWork = {
      execute: async (work) => {
        unitOfWorkCalls += 1;
        return unitOfWork.execute(work);
      },
    };
    const useCase = new CreateWalletUseCase(
      guardedUnitOfWork,
      new SequenceIdGenerator(Object.values(IDS)),
      new FixedClock(),
    );

    await expect(
      useCase.execute({
        playerId: '20000000-0000-4000-8000-000000000201',
        initialBalance: { amount: '100.00', currency: 'BRL' },
        correlationId: '   ',
      }),
    ).rejects.toBeInstanceOf(InvalidCorrelationIdError);
    expect(unitOfWorkCalls).toBe(0);
  });
});
