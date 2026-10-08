import { describe, expect, test } from 'bun:test';

import type { LedgerCursorCodec } from '../../../src/application/ports/ledger-cursor-codec.js';
import type {
  PersistenceRepositories,
  WalletLedgerPagePosition,
  WalletLedgerPageQuery,
} from '../../../src/application/ports/persistence/repositories.js';
import type { UnitOfWork } from '../../../src/application/ports/persistence/unit-of-work.js';
import {
  InvalidLedgerPageLimitError,
  WalletNotFoundError,
} from '../../../src/application/errors/wallet-application.error.js';
import { GetWalletLedgerUseCase } from '../../../src/application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { GetWalletUseCase } from '../../../src/application/use-cases/wallet/get-wallet.use-case.js';
import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';

const WALLET_ID = '10000000-0000-4000-8000-000000000301';
const PLAYER_ID = '20000000-0000-4000-8000-000000000301';
const CREATED_AT = new Date('2026-10-08T16:00:00.000Z');

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function wallet(): Wallet {
  return Wallet.open({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    initialBalance: money('30.00'),
    openedAt: CREATED_AT,
  });
}

function ledgerEntry(
  sequence: number,
  balanceBefore: string,
  balanceAfter: string,
): WalletLedgerEntry {
  return WalletLedgerEntry.create({
    id: `40000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    walletId: WALLET_ID,
    transactionId: `30000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
    direction: LedgerDirection.Credit,
    money: money('10.00'),
    balanceBefore: money(balanceBefore),
    balanceAfter: money(balanceAfter),
    createdAt: new Date(CREATED_AT.getTime() + sequence),
  });
}

function queryContext(options: {
  readonly existingWallet?: Wallet;
  readonly entries?: readonly WalletLedgerEntry[];
}): {
  readonly unitOfWork: UnitOfWork;
  readonly ledgerQueries: Array<{
    walletId: string;
    query: WalletLedgerPageQuery;
  }>;
} {
  const ledgerQueries: Array<{
    walletId: string;
    query: WalletLedgerPageQuery;
  }> = [];
  const repositories = {
    wallets: {
      findById: async () => options.existingWallet,
      findByIdForUpdate: async () => options.existingWallet,
      findByPlayerAndCurrency: async () => undefined,
      add: async () => undefined,
      save: async () => undefined,
    },
    walletReconciliations: {
      findByWalletId: async () => undefined,
    },
    wagerTransactions: {
      findById: async () => undefined,
      findByIdempotencyKey: async () => undefined,
      findByProviderTransaction: async () => undefined,
      add: async () => undefined,
      save: async () => undefined,
    },
    walletLedgerEntries: {
      findByWalletAndTransaction: async () => undefined,
      listByWallet: async (walletId: string, query: WalletLedgerPageQuery) => {
        ledgerQueries.push({ walletId, query });
        return options.entries ?? [];
      },
      add: async () => undefined,
    },
    inboxMessages: {
      findByIdentity: async () => undefined,
      add: async () => undefined,
      save: async () => undefined,
    },
    outboxMessages: {
      findById: async () => undefined,
      add: async () => undefined,
      save: async () => undefined,
    },
  } satisfies PersistenceRepositories;

  return {
    ledgerQueries,
    unitOfWork: {
      execute: async <T>(work: (context: PersistenceRepositories) => Promise<T>) =>
        work(repositories),
    },
  };
}

class CursorCodecDouble implements LedgerCursorCodec {
  readonly encoded: WalletLedgerPagePosition[] = [];
  readonly decoded: string[] = [];

  constructor(private readonly decodedPosition: WalletLedgerPagePosition) {}

  encode(position: WalletLedgerPagePosition): string {
    this.encoded.push(position);
    return `encoded:${position.id}`;
  }

  decode(cursor: string): WalletLedgerPagePosition {
    this.decoded.push(cursor);
    return this.decodedPosition;
  }
}

describe('GetWalletUseCase', () => {
  test('returns a plain immutable wallet snapshot', async () => {
    const context = queryContext({ existingWallet: wallet() });
    const result = await new GetWalletUseCase(context.unitOfWork).execute(
      WALLET_ID,
    );

    expect(result).toEqual({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      balance: { amount: '30.00', currency: 'BRL' },
      version: 1,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.balance)).toBe(true);
  });

  test('fails with a stable application error when the wallet does not exist', async () => {
    const context = queryContext({});

    await expect(
      new GetWalletUseCase(context.unitOfWork).execute(WALLET_ID),
    ).rejects.toBeInstanceOf(WalletNotFoundError);
  });
});

describe('GetWalletLedgerUseCase', () => {
  test('decodes the cursor, requests one extra row, and emits the next stable cursor', async () => {
    const entries = [
      ledgerEntry(3, '20.00', '30.00'),
      ledgerEntry(2, '10.00', '20.00'),
      ledgerEntry(1, '0.00', '10.00'),
    ];
    const context = queryContext({ existingWallet: wallet(), entries });
    const decodedPosition = {
      createdAt: new Date('2026-10-08T17:00:00.000Z'),
      id: 'cursor-entry',
    };
    const codec = new CursorCodecDouble(decodedPosition);

    const result = await new GetWalletLedgerUseCase(
      context.unitOfWork,
      codec,
    ).execute({ walletId: WALLET_ID, cursor: 'incoming-cursor', limit: 2 });

    expect(codec.decoded).toEqual(['incoming-cursor']);
    expect(context.ledgerQueries).toEqual([
      { walletId: WALLET_ID, query: { before: decodedPosition, limit: 3 } },
    ]);
    expect(result.items.map((item) => item.id)).toEqual([
      entries[0]!.id,
      entries[1]!.id,
    ]);
    expect(result.nextCursor).toBe(`encoded:${entries[1]!.id}`);
    expect(codec.encoded).toEqual([
      { createdAt: entries[1]!.createdAt, id: entries[1]!.id },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.items)).toBe(true);
    expect(Object.isFrozen(result.items[0])).toBe(true);
    expect(Object.isFrozen(result.items[0]?.money)).toBe(true);
    expect(Object.isFrozen(result.items[0]?.balanceBefore)).toBe(true);
    expect(Object.isFrozen(result.items[0]?.balanceAfter)).toBe(true);
  });

  test('uses the documented default and omits a cursor on the final page', async () => {
    const entry = ledgerEntry(1, '0.00', '10.00');
    const context = queryContext({ existingWallet: wallet(), entries: [entry] });
    const codec = new CursorCodecDouble({
      createdAt: CREATED_AT,
      id: 'unused',
    });

    const result = await new GetWalletLedgerUseCase(
      context.unitOfWork,
      codec,
    ).execute({ walletId: WALLET_ID });

    expect(context.ledgerQueries[0]?.query).toEqual({
      before: undefined,
      limit: 51,
    });
    expect(result.nextCursor).toBeUndefined();
    expect(result.items[0]).toEqual({
      id: entry.id,
      transactionId: entry.transactionId,
      direction: LedgerDirection.Credit,
      money: { amount: '10.00', currency: 'BRL' },
      balanceBefore: { amount: '0.00', currency: 'BRL' },
      balanceAfter: { amount: '10.00', currency: 'BRL' },
      createdAt: entry.createdAt.toISOString(),
    });
  });

  test.each([0, -1, 1.5])('rejects invalid page limit %p before persistence', async (limit) => {
    const context = queryContext({ existingWallet: wallet() });
    const codec = new CursorCodecDouble({ createdAt: CREATED_AT, id: 'unused' });

    expect(() =>
      new GetWalletLedgerUseCase(context.unitOfWork, codec).execute({
        walletId: WALLET_ID,
        limit,
      }),
    ).toThrow(InvalidLedgerPageLimitError);
    expect(context.ledgerQueries).toEqual([]);
  });

  test('does not query ledger entries for a missing wallet', async () => {
    const context = queryContext({});
    const codec = new CursorCodecDouble({ createdAt: CREATED_AT, id: 'unused' });

    await expect(
      new GetWalletLedgerUseCase(context.unitOfWork, codec).execute({
        walletId: WALLET_ID,
      }),
    ).rejects.toBeInstanceOf(WalletNotFoundError);
    expect(context.ledgerQueries).toEqual([]);
  });
});
