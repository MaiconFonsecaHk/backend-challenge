import { describe, expect, test } from 'bun:test';

import { WagerTransactionNotFoundError } from '../../../src/application/errors/wager-application.error.js';
import type {
  PersistenceRepositories,
  WagerTransactionRecord,
} from '../../../src/application/ports/persistence/repositories.js';
import type {
  UnitOfWork,
  UnitOfWorkCallback,
} from '../../../src/application/ports/persistence/unit-of-work.js';
import {
  GetProviderWagerTransactionUseCase,
  GetWagerTransactionByIdUseCase,
} from '../../../src/application/use-cases/wagering/get-wager-transaction.use-cases.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';

const CREATED_AT = new Date('2026-10-08T21:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-08T21:00:01.000Z');
const TRANSACTION_ID = '30000000-0000-4000-8000-000000000801';

class UnitOfWorkDouble implements UnitOfWork {
  constructor(private readonly repositories: PersistenceRepositories) {}

  execute<T>(work: UnitOfWorkCallback<T>): Promise<T> {
    return Promise.resolve(work(this.repositories));
  }
}

interface RepositoryCapture {
  readonly byId: string[];
  readonly byProvider: Array<{
    providerId: string;
    externalTransactionId: string;
  }>;
}

function record(
  status: WagerTransactionStatus = WagerTransactionStatus.Processed,
): WagerTransactionRecord {
  const transaction = WagerTransaction.rehydrate({
    id: TRANSACTION_ID,
    providerId: 'provider-query',
    externalTransactionId: 'external-query-801',
    idempotencyKey: 'provider-query:external-query-801',
    payloadHash: 'private-payload-hash',
    walletId: '10000000-0000-4000-8000-000000000801',
    playerId: '20000000-0000-4000-8000-000000000801',
    roundId: 'round-query-801',
    gameId: 'game-query-801',
    kind: WagerTransactionKind.Refund,
    money: Money.from({ amount: '25.00', currency: 'BRL' }),
    referenceExternalTransactionId: 'reference-external-800',
    createdAt: CREATED_AT,
    status,
    ...(status === WagerTransactionStatus.Processed
      ? {
          referenceTransactionId:
            '30000000-0000-4000-8000-000000000800',
          processedAt: PROCESSED_AT,
        }
      : status === WagerTransactionStatus.Rejected
        ? {
            failureCode: 'INVALID_TRANSACTION_REFERENCE',
            processedAt: PROCESSED_AT,
          }
        : {}),
  });

  return {
    transaction,
    resultBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    referenceAttempts:
      status === WagerTransactionStatus.PendingReference ? 2 : 0,
    ...(status === WagerTransactionStatus.PendingReference
      ? { nextReferenceAttemptAt: new Date('2026-10-08T21:05:00.000Z') }
      : {}),
  };
}

function repositories(
  found: WagerTransactionRecord | undefined,
  capture: RepositoryCapture,
): PersistenceRepositories {
  return {
    wagerTransactions: {
      findById: async (transactionId: string) => {
        capture.byId.push(transactionId);
        return found;
      },
      findByProviderTransaction: async (
        providerId: string,
        externalTransactionId: string,
      ) => {
        capture.byProvider.push({ providerId, externalTransactionId });
        return found;
      },
    },
  } as unknown as PersistenceRepositories;
}

function capture(): RepositoryCapture {
  return { byId: [], byProvider: [] };
}

describe('wager transaction queries', () => {
  test('returns the same deeply immutable public snapshot by internal id', async () => {
    const calls = capture();
    const useCase = new GetWagerTransactionByIdUseCase(
      new UnitOfWorkDouble(repositories(record(), calls)),
    );

    const result = await useCase.execute(TRANSACTION_ID);

    expect(calls.byId).toEqual([TRANSACTION_ID]);
    expect(calls.byProvider).toEqual([]);
    expect(result).toEqual({
      transactionId: TRANSACTION_ID,
      providerId: 'provider-query',
      externalTransactionId: 'external-query-801',
      walletId: '10000000-0000-4000-8000-000000000801',
      playerId: '20000000-0000-4000-8000-000000000801',
      roundId: 'round-query-801',
      gameId: 'game-query-801',
      kind: WagerTransactionKind.Refund,
      status: WagerTransactionStatus.Processed,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: 'reference-external-800',
      referenceTransactionId: '30000000-0000-4000-8000-000000000800',
      balance: { amount: '100.00', currency: 'BRL' },
      createdAt: '2026-10-08T21:00:00.000Z',
      processedAt: '2026-10-08T21:00:01.000Z',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.money)).toBe(true);
    expect(Object.isFrozen(result.balance)).toBe(true);
    expect(result).not.toHaveProperty('idempotencyKey');
    expect(result).not.toHaveProperty('payloadHash');
    expect(result).not.toHaveProperty('referenceAttempts');
    expect(result).not.toHaveProperty('nextReferenceAttemptAt');
  });

  test('returns the same response contract through provider identity', async () => {
    const calls = capture();
    const useCase = new GetProviderWagerTransactionUseCase(
      new UnitOfWorkDouble(repositories(record(), calls)),
    );

    const result = await useCase.execute({
      providerId: 'provider-query',
      externalTransactionId: 'external-query-801',
    });

    expect(calls.byId).toEqual([]);
    expect(calls.byProvider).toEqual([
      {
        providerId: 'provider-query',
        externalTransactionId: 'external-query-801',
      },
    ]);
    expect(result.transactionId).toBe(TRANSACTION_ID);
    expect(result.status).toBe(WagerTransactionStatus.Processed);
  });

  test('preserves rejected status and failure without inventing a resolved reference', async () => {
    const result = await new GetWagerTransactionByIdUseCase(
      new UnitOfWorkDouble(repositories(record(WagerTransactionStatus.Rejected), capture())),
    ).execute(TRANSACTION_ID);

    expect(result).toMatchObject({
      status: WagerTransactionStatus.Rejected,
      failureCode: 'INVALID_TRANSACTION_REFERENCE',
      processedAt: '2026-10-08T21:00:01.000Z',
    });
    expect(result).not.toHaveProperty('referenceTransactionId');
  });

  test('preserves pending status without exposing internal retry scheduling', async () => {
    const result = await new GetWagerTransactionByIdUseCase(
      new UnitOfWorkDouble(
        repositories(record(WagerTransactionStatus.PendingReference), capture()),
      ),
    ).execute(TRANSACTION_ID);

    expect(result).toMatchObject({
      status: WagerTransactionStatus.PendingReference,
      referenceExternalTransactionId: 'reference-external-800',
      balance: { amount: '100.00', currency: 'BRL' },
    });
    expect(result).not.toHaveProperty('processedAt');
    expect(result).not.toHaveProperty('referenceAttempts');
    expect(result).not.toHaveProperty('nextReferenceAttemptAt');
  });

  test('uses one stable not-found error for either lookup identity', async () => {
    const calls = capture();
    const unitOfWork = new UnitOfWorkDouble(repositories(undefined, calls));

    await expect(
      new GetWagerTransactionByIdUseCase(unitOfWork).execute('missing-id'),
    ).rejects.toBeInstanceOf(WagerTransactionNotFoundError);
    await expect(
      new GetProviderWagerTransactionUseCase(unitOfWork).execute({
        providerId: 'provider-query',
        externalTransactionId: 'missing-external-id',
      }),
    ).rejects.toMatchObject({ code: 'WAGER_TRANSACTION_NOT_FOUND' });
  });
});
