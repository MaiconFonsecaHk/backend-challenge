import { describe, expect, mock, test } from 'bun:test';

import {
  IdempotencyConflictError,
  InboxPayloadConflictError,
  ProviderTransactionConflictError,
} from '../../../src/application/errors/wager-application.error.js';
import type { PersistenceConflictClassifier } from '../../../src/application/ports/persistence/persistence-conflict-classifier.js';
import type { OperationalMetrics } from '../../../src/application/ports/operational-metrics.js';
import type {
  PersistenceRepositories,
  WagerTransactionRecord,
} from '../../../src/application/ports/persistence/repositories.js';
import type {
  UnitOfWork,
  UnitOfWorkCallback,
} from '../../../src/application/ports/persistence/unit-of-work.js';
import type {
  NewWagerTransactionExecutor,
  WagerTransactionProcessingCommand,
} from '../../../src/application/ports/wager-transaction-processor.js';
import { PersistentWagerTransactionProcessor } from '../../../src/application/services/persistent-wager-transaction.processor.js';
import { InboxMessage } from '../../../src/domain/messaging/inbox-message.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';

const CREATED_AT = new Date('2026-10-08T18:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-08T18:00:01.000Z');
const TRANSACTION_ID = '30000000-0000-4000-8000-000000000601';
const DELIVERY = Object.freeze({
  consumerName: 'wager-transactions-consumer',
  messageId: 'message-601',
  payloadHash: 'message-payload-hash-601',
  receivedAt: CREATED_AT,
});

function command(
  overrides: Partial<WagerTransactionProcessingCommand> = {},
): WagerTransactionProcessingCommand {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'external-601',
    idempotencyKey: 'provider-a:external-601',
    playerId: '20000000-0000-4000-8000-000000000601',
    walletId: '10000000-0000-4000-8000-000000000601',
    roundId: 'round-601',
    gameId: 'game-601',
    kind: WagerTransactionKind.Loss,
    money: { amount: '25.00', currency: 'BRL' },
    correlationId: 'correlation-601',
    payloadHash: 'payload-hash-601',
    ...overrides,
  };
}

function transactionRecord(
  overrides: Partial<WagerTransactionProcessingCommand> = {},
  options: {
    readonly failureCode?: string;
    readonly resultBalance?: Money;
  } = {},
): WagerTransactionRecord {
  const source = command(overrides);
  const transaction = WagerTransaction.create({
    id: TRANSACTION_ID,
    providerId: source.providerId,
    externalTransactionId: source.externalTransactionId,
    idempotencyKey: source.idempotencyKey,
    payloadHash: source.payloadHash,
    playerId: source.playerId,
    walletId: source.walletId,
    roundId: source.roundId,
    gameId: source.gameId,
    kind: source.kind,
    money: Money.from(source.money),
    referenceExternalTransactionId: source.referenceExternalTransactionId,
    createdAt: CREATED_AT,
  });
  if (options.failureCode === undefined) {
    transaction.markProcessed(undefined, PROCESSED_AT);
  } else {
    transaction.reject(options.failureCode, PROCESSED_AT);
  }

  return {
    transaction,
    resultBalance: options.resultBalance,
    referenceAttempts: 0,
  };
}

function wallet(): Wallet {
  return Wallet.open({
    id: command().walletId,
    playerId: command().playerId,
    initialBalance: Money.from({ amount: '100.00', currency: 'BRL' }),
    openedAt: CREATED_AT,
  });
}

class WagerRepositoryDouble {
  readonly added: WagerTransactionRecord[] = [];

  constructor(
    private readonly found: Array<WagerTransactionRecord | undefined>,
    private readonly providerFound: Array<
      WagerTransactionRecord | undefined
    > = [],
  ) {}

  async findByIdempotencyKey(): Promise<WagerTransactionRecord | undefined> {
    return this.found.shift();
  }

  async findByProviderTransaction(): Promise<
    WagerTransactionRecord | undefined
  > {
    return this.providerFound.shift();
  }

  async add(record: WagerTransactionRecord): Promise<void> {
    this.added.push(record);
  }
}

class WalletRepositoryDouble {
  readonly findByIdCalls: string[] = [];
  readonly findByIdForUpdateCalls: string[] = [];

  constructor(private readonly result: Wallet | null = wallet()) {}

  async findById(id: string): Promise<Wallet | undefined> {
    this.findByIdCalls.push(id);
    return this.result ?? undefined;
  }

  async findByIdForUpdate(id: string): Promise<Wallet | undefined> {
    this.findByIdForUpdateCalls.push(id);
    return this.result ?? undefined;
  }
}

class InboxRepositoryDouble {
  readonly added: InboxMessage[] = [];
  readonly saved: InboxMessage[] = [];

  constructor(private readonly found: Array<InboxMessage | undefined> = []) {}

  async findByIdentity(): Promise<InboxMessage | undefined> {
    return this.found.shift();
  }

  async add(message: InboxMessage): Promise<void> {
    this.added.push(message);
  }

  async save(message: InboxMessage): Promise<void> {
    this.saved.push(message);
  }
}

function repositories(
  wagers: WagerRepositoryDouble,
  wallets = new WalletRepositoryDouble(),
  inbox = new InboxRepositoryDouble(),
): PersistenceRepositories {
  return {
    wagerTransactions: wagers,
    wallets,
    inboxMessages: inbox,
  } as unknown as PersistenceRepositories;
}

class UnitOfWorkDouble implements UnitOfWork {
  calls = 0;

  constructor(
    private readonly repositories: PersistenceRepositories,
    private readonly errorsAfterWork: Array<unknown | undefined> = [],
  ) {}

  async execute<T>(work: UnitOfWorkCallback<T>): Promise<T> {
    const call = this.calls;
    this.calls += 1;
    const result = await work(this.repositories);
    const error = this.errorsAfterWork[call];
    if (error !== undefined) {
      throw error;
    }

    return result;
  }
}

class ExecutorDouble implements NewWagerTransactionExecutor {
  readonly commands: WagerTransactionProcessingCommand[] = [];
  readonly wallets: Wallet[] = [];

  constructor(private readonly record: WagerTransactionRecord) {}

  async execute(
    processingCommand: WagerTransactionProcessingCommand,
    lockedWallet: Wallet,
  ): Promise<WagerTransactionRecord> {
    this.commands.push(processingCommand);
    this.wallets.push(lockedWallet);
    return this.record;
  }
}

class ConflictClassifierDouble implements PersistenceConflictClassifier {
  constructor(
    private readonly matchingError: unknown,
    private readonly matchingInboxError?: unknown,
    private readonly matchingLockError?: unknown,
    private readonly matchingProviderError?: unknown,
  ) {}

  isWagerIdempotencyKeyConflict(error: unknown): boolean {
    return error === this.matchingError;
  }

  isInboxIdentityConflict(error: unknown): boolean {
    return error === this.matchingInboxError;
  }

  isWagerProviderTransactionConflict(error: unknown): boolean {
    return error === this.matchingProviderError;
  }

  isLockConflict(error: unknown): boolean {
    return error === this.matchingLockError;
  }
}

describe('PersistentWagerTransactionProcessor', () => {
  test('persists a new execution and returns its original immutable result', async () => {
    const created = transactionRecord({}, { resultBalance: Money.from({ amount: '75.00', currency: 'BRL' }) });
    const wagers = new WagerRepositoryDouble([undefined]);
    const wallets = new WalletRepositoryDouble();
    const executor = new ExecutorDouble(created);
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(repositories(wagers, wallets)),
      executor,
      new ConflictClassifierDouble(undefined),
    );

    const result = await processor.process(command());

    expect(executor.commands).toEqual([command()]);
    expect(executor.wallets).toHaveLength(1);
    expect(wallets.findByIdCalls).toEqual([command().walletId]);
    expect(wallets.findByIdForUpdateCalls).toEqual([]);
    expect(wagers.added).toEqual([created]);
    expect(result).toEqual({
      transactionId: TRANSACTION_ID,
      status: WagerTransactionStatus.Processed,
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.balance)).toBe(true);
  });

  test('acquires an exclusive wallet row lock before balance-changing execution', async () => {
    const processingCommand = command({ kind: WagerTransactionKind.Bet });
    const wallets = new WalletRepositoryDouble();
    const executor = new ExecutorDouble(
      transactionRecord({ kind: WagerTransactionKind.Bet }),
    );
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(new WagerRepositoryDouble([undefined]), wallets),
      ),
      executor,
      new ConflictClassifierDouble(undefined),
    );

    await processor.process(processingCommand);

    expect(wallets.findByIdCalls).toEqual([]);
    expect(wallets.findByIdForUpdateCalls).toEqual([command().walletId]);
    expect(executor.wallets).toHaveLength(1);
  });

  test('does not execute when the target wallet does not exist', async () => {
    const executor = new ExecutorDouble(transactionRecord());
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(
          new WagerRepositoryDouble([undefined]),
          new WalletRepositoryDouble(null),
        ),
      ),
      executor,
      new ConflictClassifierDouble(undefined),
    );

    await expect(processor.process(command())).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
    });
    expect(executor.commands).toEqual([]);
  });

  test('returns a stored identical result without executing or persisting again', async () => {
    const existing = transactionRecord(
      {},
      { failureCode: 'ROUND_CLOSED' },
    );
    const wagers = new WagerRepositoryDouble([existing]);
    const executor = new ExecutorDouble(transactionRecord());
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(repositories(wagers)),
      executor,
      new ConflictClassifierDouble(undefined),
    );

    expect(await processor.process(command())).toEqual({
      transactionId: TRANSACTION_ID,
      status: WagerTransactionStatus.Rejected,
      failureCode: 'ROUND_CLOSED',
      idempotentReplay: true,
    });
    expect(executor.commands).toEqual([]);
    expect(wagers.added).toEqual([]);
  });

  test('persists a processed inbox record in the same unit of work as a new wager', async () => {
    const wagers = new WagerRepositoryDouble([undefined]);
    const inbox = new InboxRepositoryDouble([undefined]);
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(repositories(wagers, undefined, inbox)),
      new ExecutorDouble(transactionRecord()),
      new ConflictClassifierDouble(undefined),
    );

    await processor.process(command({ delivery: DELIVERY }));

    expect(inbox.added).toHaveLength(1);
    expect(inbox.added[0]?.messageId).toBe(DELIVERY.messageId);
    expect(inbox.added[0]?.payloadHash).toBe(DELIVERY.payloadHash);
    expect(inbox.added[0]?.processedAt).toEqual(DELIVERY.receivedAt);
    expect(wagers.added).toHaveLength(1);
  });

  test('returns the stored wager for an identical processed message redelivery', async () => {
    const processedInbox = InboxMessage.receive(DELIVERY);
    processedInbox.markProcessed(DELIVERY.receivedAt);
    const inbox = new InboxRepositoryDouble([processedInbox]);
    const executor = new ExecutorDouble(transactionRecord());
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(new WagerRepositoryDouble([transactionRecord()]), undefined, inbox),
      ),
      executor,
      new ConflictClassifierDouble(undefined),
    );

    const result = await processor.process(command({ delivery: DELIVERY }));

    expect(result.idempotentReplay).toBeTrue();
    expect(executor.commands).toEqual([]);
    expect(inbox.added).toEqual([]);
    expect(inbox.saved).toEqual([]);
  });

  test('rejects a reused inbox identity with a different message payload', async () => {
    const existingInbox = InboxMessage.receive({
      ...DELIVERY,
      payloadHash: 'original-message-hash',
    });
    const executor = new ExecutorDouble(transactionRecord());
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(
          new WagerRepositoryDouble([]),
          undefined,
          new InboxRepositoryDouble([existingInbox]),
        ),
      ),
      executor,
      new ConflictClassifierDouble(undefined),
    );

    await expect(
      processor.process(command({ delivery: DELIVERY })),
    ).rejects.toBeInstanceOf(InboxPayloadConflictError);
    expect(executor.commands).toEqual([]);
  });

  test('completes an existing unprocessed inbox record after an idempotent wager replay', async () => {
    const existingInbox = InboxMessage.receive(DELIVERY);
    const inbox = new InboxRepositoryDouble([existingInbox]);
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(new WagerRepositoryDouble([transactionRecord()]), undefined, inbox),
      ),
      new ExecutorDouble(transactionRecord()),
      new ConflictClassifierDouble(undefined),
    );

    await processor.process(command({ delivery: DELIVERY }));

    expect(inbox.saved).toEqual([existingInbox]);
    expect(existingInbox.isProcessed()).toBeTrue();
  });

  test('rejects a reused key with a different payload before executing effects', async () => {
    const wagers = new WagerRepositoryDouble([
      transactionRecord({ payloadHash: 'original-hash' }),
    ]);
    const executor = new ExecutorDouble(transactionRecord());
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(repositories(wagers)),
      executor,
      new ConflictClassifierDouble(undefined),
    );

    await expect(
      processor.process(command({ payloadHash: 'different-hash' })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(executor.commands).toEqual([]);
    expect(wagers.added).toEqual([]);
  });

  test('reloads the committed winner after losing the unique-key race', async () => {
    const uniqueConflict = new Error('idempotency unique conflict');
    const winner = transactionRecord(
      {},
      { resultBalance: Money.from({ amount: '75.00', currency: 'BRL' }) },
    );
    const wagers = new WagerRepositoryDouble([undefined, winner]);
    const executor = new ExecutorDouble(transactionRecord());
    const unitOfWork = new UnitOfWorkDouble(repositories(wagers), [
      uniqueConflict,
    ]);
    const processor = new PersistentWagerTransactionProcessor(
      unitOfWork,
      executor,
      new ConflictClassifierDouble(uniqueConflict),
    );

    expect(await processor.process(command())).toEqual({
      transactionId: TRANSACTION_ID,
      status: WagerTransactionStatus.Processed,
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: true,
    });
    expect(unitOfWork.calls).toBe(2);
    expect(executor.commands).toHaveLength(1);
  });

  test('reports a divergent concurrent winner as a conflict', async () => {
    const uniqueConflict = new Error('idempotency unique conflict');
    const wagers = new WagerRepositoryDouble([
      undefined,
      transactionRecord({ payloadHash: 'winner-hash' }),
    ]);
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(repositories(wagers), [uniqueConflict]),
      new ExecutorDouble(transactionRecord({ payloadHash: 'loser-hash' })),
      new ConflictClassifierDouble(uniqueConflict),
    );

    await expect(
      processor.process(command({ payloadHash: 'loser-hash' })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  test('reports a provider transaction won by another idempotency key as a conflict', async () => {
    const uniqueConflict = new Error('provider transaction unique conflict');
    const winner = transactionRecord({ idempotencyKey: 'winner-key' });
    const wagers = new WagerRepositoryDouble([undefined], [winner]);
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(repositories(wagers), [uniqueConflict]),
      new ExecutorDouble(transactionRecord({ idempotencyKey: 'loser-key' })),
      new ConflictClassifierDouble(
        undefined,
        undefined,
        undefined,
        uniqueConflict,
      ),
    );

    await expect(
      processor.process(command({ idempotencyKey: 'loser-key' })),
    ).rejects.toBeInstanceOf(ProviderTransactionConflictError);
  });

  test('still returns replay if PostgreSQL reports the provider constraint for the same key', async () => {
    const uniqueConflict = new Error('provider transaction unique conflict');
    const winner = transactionRecord();
    const wagers = new WagerRepositoryDouble([undefined], [winner]);
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(repositories(wagers), [uniqueConflict]),
      new ExecutorDouble(transactionRecord()),
      new ConflictClassifierDouble(
        undefined,
        undefined,
        undefined,
        uniqueConflict,
      ),
    );

    expect(await processor.process(command())).toEqual({
      transactionId: TRANSACTION_ID,
      status: WagerTransactionStatus.Processed,
      idempotentReplay: true,
    });
  });

  test('propagates unrelated failures and the original conflict if no winner exists', async () => {
    const unrelated = new Error('database unavailable');
    const unrelatedProcessor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(new WagerRepositoryDouble([undefined])),
        [unrelated],
      ),
      new ExecutorDouble(transactionRecord()),
      new ConflictClassifierDouble(new Error('other')),
    );

    await expect(unrelatedProcessor.process(command())).rejects.toBe(unrelated);

    const uniqueConflict = new Error('idempotency unique conflict');
    const missingWinnerProcessor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(new WagerRepositoryDouble([undefined, undefined])),
        [uniqueConflict],
      ),
      new ExecutorDouble(transactionRecord()),
      new ConflictClassifierDouble(uniqueConflict),
    );

    await expect(missingWinnerProcessor.process(command())).rejects.toBe(
      uniqueConflict,
    );
  });

  test('counts a database lock conflict before propagating it', async () => {
    const lockConflict = new Error('lock timeout');
    const recordLockConflict = mock(() => undefined);
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(new WagerRepositoryDouble([undefined])),
        [lockConflict],
      ),
      new ExecutorDouble(transactionRecord()),
      new ConflictClassifierDouble(undefined, undefined, lockConflict),
      operationalMetrics({ recordLockConflict }),
    );

    await expect(processor.process(command())).rejects.toBe(lockConflict);
    expect(recordLockConflict).toHaveBeenCalledWith(WagerTransactionKind.Loss);
  });

  test('rejects a new execution record that does not match its command', async () => {
    const processor = new PersistentWagerTransactionProcessor(
      new UnitOfWorkDouble(
        repositories(new WagerRepositoryDouble([undefined])),
      ),
      new ExecutorDouble(transactionRecord({ walletId: 'another-wallet' })),
      new ConflictClassifierDouble(undefined),
    );

    await expect(processor.process(command())).rejects.toThrow(
      'does not match its command',
    );
  });
});

function operationalMetrics(overrides: Partial<OperationalMetrics>): OperationalMetrics {
  return {
    recordWagerOutcome: overrides.recordWagerOutcome ?? (() => undefined),
    recordRetry: overrides.recordRetry ?? (() => undefined),
    recordDeadLetterMessage:
      overrides.recordDeadLetterMessage ?? (() => undefined),
    recordLockConflict: overrides.recordLockConflict ?? (() => undefined),
    recordReconciliationDivergence:
      overrides.recordReconciliationDivergence ?? (() => undefined),
    setOutboxState: overrides.setOutboxState ?? (() => undefined),
    setReadiness: overrides.setReadiness ?? (() => undefined),
    recordCollectionFailure:
      overrides.recordCollectionFailure ?? (() => undefined),
    contentType: () => 'text/plain',
    render: async () => '',
  };
}
