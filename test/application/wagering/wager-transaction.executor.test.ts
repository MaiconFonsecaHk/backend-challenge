import { describe, expect, test } from 'bun:test';

import type { Clock } from '../../../src/application/ports/clock.js';
import type { IdGenerator } from '../../../src/application/ports/id-generator.js';
import type {
  PersistenceRepositories,
  WagerTransactionRecord,
  WagerTransactionRepository,
  WalletLedgerEntryRepository,
  WalletRepository,
} from '../../../src/application/ports/persistence/repositories.js';
import type { WagerTransactionProcessingCommand } from '../../../src/application/ports/wager-transaction-processor.js';
import {
  WAGER_FAILURE_CODES,
  WagerTransactionExecutor,
} from '../../../src/application/services/wager-transaction.executor.js';
import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import type { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';
import type { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';

const OCCURRED_AT = new Date('2026-10-08T20:00:00.000Z');
const WALLET_ID = '10000000-0000-4000-8000-000000000701';
const PLAYER_ID = '20000000-0000-4000-8000-000000000701';
const REFERENCE_ID = '30000000-0000-4000-8000-000000000700';

class FixedClock implements Clock {
  now(): Date {
    return new Date(OCCURRED_AT.getTime());
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
}

class WalletRepositoryDouble implements Partial<WalletRepository> {
  readonly saved: Wallet[] = [];

  async save(wallet: Wallet): Promise<void> {
    this.saved.push(wallet);
  }
}

class WagerRepositoryDouble implements Partial<WagerTransactionRepository> {
  reversal: WagerTransactionRecord | undefined;

  constructor(readonly reference?: WagerTransactionRecord) {}

  async findByProviderTransaction(): Promise<WagerTransactionRecord | undefined> {
    return this.reference;
  }

  async findByReferenceAndKind(): Promise<WagerTransactionRecord | undefined> {
    return this.reversal;
  }
}

class LedgerRepositoryDouble implements Partial<WalletLedgerEntryRepository> {
  readonly added: WalletLedgerEntry[] = [];

  async add(entry: WalletLedgerEntry): Promise<void> {
    this.added.push(entry);
  }
}

class OutboxRepositoryDouble {
  readonly added: OutboxMessage[] = [];

  async add(message: OutboxMessage): Promise<void> {
    this.added.push(message);
  }
}

interface Harness {
  readonly executor: WagerTransactionExecutor;
  readonly repositories: PersistenceRepositories;
  readonly wallets: WalletRepositoryDouble;
  readonly wagers: WagerRepositoryDouble;
  readonly ledger: LedgerRepositoryDouble;
  readonly outbox: OutboxRepositoryDouble;
}

function command(
  kind: WagerTransactionKind,
  overrides: Partial<WagerTransactionProcessingCommand> = {},
): WagerTransactionProcessingCommand {
  return {
    providerId: 'provider-a',
    externalTransactionId: `external-${kind.toLowerCase()}`,
    idempotencyKey: `provider-a:external-${kind.toLowerCase()}`,
    playerId: PLAYER_ID,
    walletId: WALLET_ID,
    roundId: 'round-701',
    gameId: 'game-701',
    kind: kind as Exclude<WagerTransactionKind, WagerTransactionKind.Opening>,
    money: { amount: '25.00', currency: 'BRL' },
    ...(kind === WagerTransactionKind.Refund ||
    kind === WagerTransactionKind.Rollback
      ? { referenceExternalTransactionId: 'reference-external-700' }
      : {}),
    correlationId: 'correlation-701',
    payloadHash: `payload-${kind.toLowerCase()}`,
    ...overrides,
  };
}

function wallet(balance = '100.00'): Wallet {
  return Wallet.open({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    initialBalance: Money.from({ amount: balance, currency: 'BRL' }),
    openedAt: new Date('2026-10-08T19:00:00.000Z'),
  });
}

function processedReference(
  kind: WagerTransactionKind.Bet | WagerTransactionKind.Win | WagerTransactionKind.Refund,
  overrides: Partial<{
    providerId: string;
    playerId: string;
    walletId: string;
    roundId: string;
    amount: string;
  }> = {},
): WagerTransactionRecord {
  const referenceExternalTransactionId =
    kind === WagerTransactionKind.Refund ? 'original-bet-external' : undefined;
  const transaction = WagerTransaction.create({
    id: REFERENCE_ID,
    providerId: overrides.providerId ?? 'provider-a',
    externalTransactionId: 'reference-external-700',
    idempotencyKey: 'provider-a:reference-external-700',
    payloadHash: 'reference-payload-700',
    playerId: overrides.playerId ?? PLAYER_ID,
    walletId: overrides.walletId ?? WALLET_ID,
    roundId: overrides.roundId ?? 'round-701',
    gameId: 'game-700',
    kind,
    money: Money.from({
      amount: overrides.amount ?? '25.00',
      currency: 'BRL',
    }),
    referenceExternalTransactionId,
    createdAt: new Date('2026-10-08T18:00:00.000Z'),
  });
  transaction.markProcessed(
    referenceExternalTransactionId === undefined
      ? undefined
      : '30000000-0000-4000-8000-000000000699',
    new Date('2026-10-08T18:01:00.000Z'),
  );

  return {
    transaction,
    resultBalance: Money.from({ amount: '75.00', currency: 'BRL' }),
    referenceAttempts: 0,
  };
}

function createHarness(
  reference?: WagerTransactionRecord,
  idCount = 6,
): Harness {
  const wallets = new WalletRepositoryDouble();
  const wagers = new WagerRepositoryDouble(reference);
  const ledger = new LedgerRepositoryDouble();
  const outbox = new OutboxRepositoryDouble();
  const ids = Array.from(
    { length: idCount },
    (_, index) =>
      `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const repositories = {
    wallets,
    wagerTransactions: wagers,
    walletLedgerEntries: ledger,
    outboxMessages: outbox,
  } as unknown as PersistenceRepositories;

  return {
    executor: new WagerTransactionExecutor(
      new SequenceIdGenerator(ids),
      new FixedClock(),
    ),
    repositories,
    wallets,
    wagers,
    ledger,
    outbox,
  };
}

function eventTypes(harness: Harness): string[] {
  return harness.outbox.added.map((message) => message.eventType);
}

describe('WagerTransactionExecutor', () => {
  test('processes BET as one debit with matching wallet, ledger, and outbox effects', async () => {
    const harness = createHarness();
    const target = wallet();

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Bet),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(record.resultBalance?.toJSON()).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(target.balance.toJSON()).toEqual({ amount: '75.00', currency: 'BRL' });
    expect(target.version).toBe(2);
    expect(harness.wallets.saved).toEqual([target]);
    expect(harness.ledger.added).toHaveLength(1);
    expect(harness.ledger.added[0]).toMatchObject({
      direction: LedgerDirection.Debit,
      transactionId: record.transaction.id,
    });
    expect(eventTypes(harness)).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
  });

  test('rejects an unaffordable BET without changing wallet or creating ledger', async () => {
    const harness = createHarness();
    const target = wallet('20.00');

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Bet),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(record.transaction.failureCode).toBe(WAGER_FAILURE_CODES.insufficientFunds);
    expect(record.resultBalance?.toJSON()).toEqual({ amount: '20.00', currency: 'BRL' });
    expect(target.version).toBe(1);
    expect(harness.wallets.saved).toEqual([]);
    expect(harness.ledger.added).toEqual([]);
    expect(eventTypes(harness)).toEqual(['WagerTransactionRejected']);
  });

  test('processes WIN as one credit with or without a valid BET reference', async () => {
    for (const reference of [undefined, processedReference(WagerTransactionKind.Bet)]) {
      const harness = createHarness(reference);
      const target = wallet();
      const withReference = reference === undefined
        ? {}
        : { referenceExternalTransactionId: 'reference-external-700' };

      const record = await harness.executor.execute(
        command(WagerTransactionKind.Win, withReference),
        target,
        harness.repositories,
      );

      expect(record.transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(record.transaction.referenceTransactionId).toBe(reference?.transaction.id);
      expect(target.balance.toJSON()).toEqual({ amount: '125.00', currency: 'BRL' });
      expect(harness.ledger.added[0]?.direction).toBe(LedgerDirection.Credit);
      expect(eventTypes(harness)).toEqual([
        'WagerTransactionProcessed',
        'WalletBalanceChanged',
      ]);
    }
  });

  test('processes LOSS without changing wallet, version, or ledger', async () => {
    const harness = createHarness();
    const target = wallet();

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Loss),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(record.resultBalance?.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(target.version).toBe(1);
    expect(harness.wallets.saved).toEqual([]);
    expect(harness.ledger.added).toEqual([]);
    expect(eventTypes(harness)).toEqual(['WagerTransactionProcessed']);
  });

  test('processes REFUND once as a credit of the referenced BET amount', async () => {
    const reference = processedReference(WagerTransactionKind.Bet);
    const harness = createHarness(reference);
    const target = wallet('75.00');

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Refund),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(record.transaction.referenceTransactionId).toBe(REFERENCE_ID);
    expect(target.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(harness.ledger.added[0]?.direction).toBe(LedgerDirection.Credit);
  });

  test.each([
    [WagerTransactionKind.Bet, LedgerDirection.Credit, '125.00'],
    [WagerTransactionKind.Win, LedgerDirection.Debit, '75.00'],
    [WagerTransactionKind.Refund, LedgerDirection.Debit, '75.00'],
  ] as const)(
    'ROLLBACK applies the inverse effect of a processed %s reference',
    async (referenceKind, direction, expectedBalance) => {
      const harness = createHarness(processedReference(referenceKind));
      const target = wallet();

      const record = await harness.executor.execute(
        command(WagerTransactionKind.Rollback),
        target,
        harness.repositories,
      );

      expect(record.transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(record.transaction.referenceTransactionId).toBe(REFERENCE_ID);
      expect(target.balance.toJSON().amount).toBe(expectedBalance);
      expect(harness.ledger.added[0]?.direction).toBe(direction);
    },
  );

  test('keeps a missing dependent reference pending and auditably emits no financial effect', async () => {
    const harness = createHarness();
    const target = wallet();

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Refund),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(record.referenceAttempts).toBe(0);
    expect(target.version).toBe(1);
    expect(harness.wallets.saved).toEqual([]);
    expect(harness.ledger.added).toEqual([]);
    expect(eventTypes(harness)).toEqual(['WagerTransactionPendingReference']);
  });

  test.each([
    ['wrong kind', processedReference(WagerTransactionKind.Win)],
    [
      'wrong context',
      processedReference(WagerTransactionKind.Bet, { roundId: 'another-round' }),
    ],
    [
      'wrong amount',
      processedReference(WagerTransactionKind.Bet, { amount: '24.00' }),
    ],
  ])('rejects a REFUND with %s without changing balance', async (_case, reference) => {
    const harness = createHarness(reference);
    const target = wallet();

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Refund),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(record.transaction.failureCode).toBe(WAGER_FAILURE_CODES.invalidReference);
    expect(target.balance.toJSON().amount).toBe('100.00');
    expect(target.version).toBe(1);
    expect(harness.ledger.added).toEqual([]);
    expect(eventTypes(harness)).toEqual(['WagerTransactionRejected']);
  });

  test('rejects a second reversal of the same kind without duplicating the effect', async () => {
    const reference = processedReference(WagerTransactionKind.Bet);
    const harness = createHarness(reference);
    harness.wagers.reversal = processedReference(WagerTransactionKind.Refund);
    const target = wallet();

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Refund),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(record.transaction.failureCode).toBe(
      WAGER_FAILURE_CODES.referenceAlreadyReversed,
    );
    expect(target.balance.toJSON().amount).toBe('100.00');
    expect(harness.ledger.added).toEqual([]);
  });

  test('uses a distinct failure code when a reversal debit would make balance negative', async () => {
    const harness = createHarness(processedReference(WagerTransactionKind.Win));
    const target = wallet('20.00');

    const record = await harness.executor.execute(
      command(WagerTransactionKind.Rollback),
      target,
      harness.repositories,
    );

    expect(record.transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(record.transaction.failureCode).toBe(
      WAGER_FAILURE_CODES.reversalInsufficientFunds,
    );
    expect(record.transaction.failureCode).not.toBe(
      WAGER_FAILURE_CODES.insufficientFunds,
    );
    expect(target.balance.toJSON().amount).toBe('20.00');
    expect(target.version).toBe(1);
    expect(harness.ledger.added).toEqual([]);
  });
});
