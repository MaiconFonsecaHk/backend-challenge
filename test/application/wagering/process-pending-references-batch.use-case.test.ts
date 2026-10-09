import { describe, expect, test } from 'bun:test';

import type { Clock } from '../../../src/application/ports/clock.js';
import type {
  PersistenceRepositories,
  WagerTransactionRecord,
} from '../../../src/application/ports/persistence/repositories.js';
import type { UnitOfWork } from '../../../src/application/ports/persistence/unit-of-work.js';
import { WagerTransactionExecutor } from '../../../src/application/services/wager-transaction.executor.js';
import { ProcessPendingReferencesBatchUseCase } from '../../../src/application/use-cases/wagering/process-pending-references-batch.use-case.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const WALLET_ID = '10000000-0000-4000-8000-000000000801';

class FixedClock implements Clock {
  now(): Date {
    return new Date(NOW.getTime());
  }
}

function record(
  id: string,
  status: WagerTransactionStatus,
): WagerTransactionRecord {
  const terminal =
    status === WagerTransactionStatus.Processed ||
    status === WagerTransactionStatus.Rejected;
  return Object.freeze({
    transaction: WagerTransaction.rehydrate({
      id,
      providerId: 'provider-a',
      externalTransactionId: `external-${id}`,
      idempotencyKey: `provider-a:${id}`,
      payloadHash: `payload-${id}`,
      walletId: WALLET_ID,
      playerId: '20000000-0000-4000-8000-000000000801',
      roundId: 'round-801',
      gameId: 'game-801',
      kind: WagerTransactionKind.Refund,
      money: Money.from({ amount: '10.00', currency: 'BRL' }),
      referenceExternalTransactionId: 'reference-801',
      createdAt: new Date('2026-10-09T11:00:00.000Z'),
      status,
      ...(status === WagerTransactionStatus.Processed
        ? { referenceTransactionId: '30000000-0000-4000-8000-000000000801' }
        : {}),
      ...(status === WagerTransactionStatus.Rejected
        ? { failureCode: 'REFERENCE_NOT_FOUND' }
        : {}),
      ...(terminal ? { processedAt: NOW } : {}),
    }),
    resultBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    referenceAttempts: 1,
    ...(status === WagerTransactionStatus.PendingReference
      ? { nextReferenceAttemptAt: new Date('2026-10-09T12:01:00.000Z') }
      : {}),
  });
}

describe('ProcessPendingReferencesBatchUseCase', () => {
  test('claims one transaction per unit of work and counts every terminal outcome', async () => {
    const claimed = [
      record('30000000-0000-4000-8000-000000000811', WagerTransactionStatus.PendingReference),
      record('30000000-0000-4000-8000-000000000812', WagerTransactionStatus.PendingReference),
      record('30000000-0000-4000-8000-000000000813', WagerTransactionStatus.PendingReference),
    ];
    const updated = [
      record('30000000-0000-4000-8000-000000000811', WagerTransactionStatus.Processed),
      record('30000000-0000-4000-8000-000000000812', WagerTransactionStatus.Rejected),
      record('30000000-0000-4000-8000-000000000813', WagerTransactionStatus.PendingReference),
    ];
    const saved: WagerTransactionRecord[] = [];
    const lockedWalletIds: string[] = [];
    const claimTimes: Date[] = [];
    const targetWallet = Wallet.open({
      id: WALLET_ID,
      playerId: '20000000-0000-4000-8000-000000000801',
      initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
      openedAt: new Date('2026-10-09T10:00:00.000Z'),
    });
    const repositories = {
      wallets: {
        findByIdForUpdate: async (walletId: string) => {
          lockedWalletIds.push(walletId);
          return targetWallet;
        },
      },
      wagerTransactions: {
        findNextPendingReferenceDueForUpdate: async (now: Date) => {
          claimTimes.push(now);
          return claimed.shift();
        },
        save: async (candidate: WagerTransactionRecord) => {
          saved.push(candidate);
        },
      },
    } as unknown as PersistenceRepositories;
    let transactions = 0;
    const unitOfWork: UnitOfWork = {
      execute: async (work) => {
        transactions += 1;
        return work(repositories);
      },
    };
    const executor = {
      resumePendingReference: async () => updated.shift()!,
    } as unknown as WagerTransactionExecutor;
    const useCase = new ProcessPendingReferencesBatchUseCase(
      unitOfWork,
      executor,
      new FixedClock(),
    );

    expect(await useCase.execute(10)).toEqual({
      claimed: 3,
      processed: 1,
      rejected: 1,
      rescheduled: 1,
    });
    expect(transactions).toBe(4);
    expect(saved).toHaveLength(3);
    expect(lockedWalletIds).toEqual([WALLET_ID, WALLET_ID, WALLET_ID]);
    expect(claimTimes.every((time) => time.getTime() === NOW.getTime())).toBeTrue();
  });

  test('rejects an invalid limit before opening the unit of work', async () => {
    let opened = false;
    const unitOfWork: UnitOfWork = {
      execute: async () => {
        opened = true;
        throw new Error('should not execute');
      },
    };
    const useCase = new ProcessPendingReferencesBatchUseCase(
      unitOfWork,
      {} as WagerTransactionExecutor,
      new FixedClock(),
    );

    await expect(useCase.execute(0)).rejects.toThrow(
      'Pending-reference batch limit must be a positive safe integer.',
    );
    expect(opened).toBeFalse();
  });
});
