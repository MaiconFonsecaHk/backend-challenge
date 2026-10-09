import { describe, expect, test } from 'bun:test';

import { WalletNotFoundError } from '../../../src/application/errors/wallet-application.error.js';
import type {
  PersistenceRepositories,
  WalletReconciliationSnapshot,
} from '../../../src/application/ports/persistence/repositories.js';
import type { UnitOfWork } from '../../../src/application/ports/persistence/unit-of-work.js';
import { ReconcileWalletUseCase } from '../../../src/application/use-cases/wallet/reconcile-wallet.use-case.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';

const WALLET_ID = '10000000-0000-4000-8000-000000000401';

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function reconciliationContext(snapshot?: WalletReconciliationSnapshot): {
  readonly unitOfWork: UnitOfWork;
  readonly requestedWalletIds: string[];
} {
  const requestedWalletIds: string[] = [];
  const unexpectedWrite = async () => {
    throw new Error('Reconciliation must not write persistence state');
  };
  const repositories = {
    wallets: {
      findById: async () => undefined,
      findByIdForUpdate: async () => undefined,
      findByPlayerAndCurrency: async () => undefined,
      add: unexpectedWrite,
      save: unexpectedWrite,
    },
    walletReconciliations: {
      findByWalletId: async (walletId: string) => {
        requestedWalletIds.push(walletId);
        return snapshot;
      },
    },
    wagerTransactions: {
      findById: async () => undefined,
      findNextPendingReferenceDueForUpdate: async () => undefined,
      findByIdempotencyKey: async () => undefined,
      findByProviderTransaction: async () => undefined,
      findByReferenceAndKind: async () => undefined,
      add: unexpectedWrite,
      save: unexpectedWrite,
    },
    walletLedgerEntries: {
      findByWalletAndTransaction: async () => undefined,
      listByWallet: async () => [],
      add: unexpectedWrite,
    },
    inboxMessages: {
      findByIdentity: async () => undefined,
      add: unexpectedWrite,
      save: unexpectedWrite,
    },
    outboxMessages: {
      findById: async () => undefined,
      findDueForUpdate: async () => [],
      add: unexpectedWrite,
      save: unexpectedWrite,
    },
  } satisfies PersistenceRepositories;

  return {
    requestedWalletIds,
    unitOfWork: {
      execute: async <T>(work: (context: PersistenceRepositories) => Promise<T>) =>
        work(repositories),
    },
  };
}

describe('ReconcileWalletUseCase', () => {
  test('reports an exact consistent snapshot without mutating persistence', async () => {
    const context = reconciliationContext({
      storedBalance: money('9007199254740993.12'),
      calculatedBalance: money('9007199254740993.12'),
      checkedEntries: 42,
    });

    const result = await new ReconcileWalletUseCase(
      context.unitOfWork,
    ).execute(WALLET_ID);

    expect(result).toEqual({
      walletId: WALLET_ID,
      storedBalance: { amount: '9007199254740993.12', currency: 'BRL' },
      calculatedBalance: { amount: '9007199254740993.12', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 42,
    });
    expect(context.requestedWalletIds).toEqual([WALLET_ID]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.storedBalance)).toBe(true);
    expect(Object.isFrozen(result.calculatedBalance)).toBe(true);
    expect(Object.isFrozen(result.difference)).toBe(true);
  });

  test('signals a divergence as stored minus calculated without correcting it', async () => {
    const context = reconciliationContext({
      storedBalance: money('75.00'),
      calculatedBalance: money('100.00'),
      checkedEntries: 3,
    });

    const result = await new ReconcileWalletUseCase(
      context.unitOfWork,
    ).execute(WALLET_ID);

    expect(result).toEqual({
      walletId: WALLET_ID,
      storedBalance: { amount: '75.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '-25.00', currency: 'BRL' },
      consistent: false,
      checkedEntries: 3,
    });
  });

  test('reconciles a zero-balance wallet with no ledger entries', async () => {
    const context = reconciliationContext({
      storedBalance: money('0.00'),
      calculatedBalance: money('0.00'),
      checkedEntries: 0,
    });

    const result = await new ReconcileWalletUseCase(
      context.unitOfWork,
    ).execute(WALLET_ID);

    expect(result.consistent).toBe(true);
    expect(result.difference.amount).toBe('0.00');
    expect(result.checkedEntries).toBe(0);
  });

  test('fails with a stable application error when the wallet does not exist', async () => {
    const context = reconciliationContext();

    await expect(
      new ReconcileWalletUseCase(context.unitOfWork).execute(WALLET_ID),
    ).rejects.toBeInstanceOf(WalletNotFoundError);
    expect(context.requestedWalletIds).toEqual([WALLET_ID]);
  });
});
