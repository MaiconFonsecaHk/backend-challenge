import { describe, expect, test } from 'bun:test';
import { LockMode } from '@mikro-orm/core';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

import type { WagerTransactionRecord } from '../../../src/application/ports/persistence/repositories.js';
import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';
import { InboxMessage } from '../../../src/domain/messaging/inbox-message.js';
import { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../../src/domain/wagering/wager-transaction.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import { InboxMessagePersistenceEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.persistence-entity.js';
import { OutboxMessagePersistenceEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.persistence-entity.js';
import { WagerTransactionPersistenceEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.persistence-entity.js';
import { WalletLedgerEntryPersistenceEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.persistence-entity.js';
import { WalletPersistenceEntity } from '../../../src/infrastructure/persistence/entities/wallet.persistence-entity.js';
import { InboxMessagePersistenceMapper } from '../../../src/infrastructure/persistence/mappers/inbox-message.persistence-mapper.js';
import { OutboxMessagePersistenceMapper } from '../../../src/infrastructure/persistence/mappers/outbox-message.persistence-mapper.js';
import { WagerTransactionPersistenceMapper } from '../../../src/infrastructure/persistence/mappers/wager-transaction.persistence-mapper.js';
import { WalletLedgerEntryPersistenceMapper } from '../../../src/infrastructure/persistence/mappers/wallet-ledger-entry.persistence-mapper.js';
import { WalletPersistenceMapper } from '../../../src/infrastructure/persistence/mappers/wallet.persistence-mapper.js';
import { MikroOrmUnitOfWork } from '../../../src/infrastructure/persistence/mikro-orm.unit-of-work.js';
import { MikroOrmInboxMessageRepository } from '../../../src/infrastructure/persistence/repositories/mikro-orm-inbox-message.repository.js';
import { MikroOrmOutboxMessageRepository } from '../../../src/infrastructure/persistence/repositories/mikro-orm-outbox-message.repository.js';
import { MikroOrmWagerTransactionRepository } from '../../../src/infrastructure/persistence/repositories/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerEntryRepository } from '../../../src/infrastructure/persistence/repositories/mikro-orm-wallet-ledger-entry.repository.js';
import { MikroOrmWalletReconciliationRepository } from '../../../src/infrastructure/persistence/repositories/mikro-orm-wallet-reconciliation.repository.js';
import { MikroOrmWalletRepository } from '../../../src/infrastructure/persistence/repositories/mikro-orm-wallet.repository.js';
import { PersistenceRecordNotFoundError } from '../../../src/infrastructure/persistence/repositories/persistence-record-not-found.error.js';

const CREATED_AT = new Date('2026-10-08T12:00:00.000Z');
const UPDATED_AT = new Date('2026-10-08T12:05:00.000Z');
const WALLET_ID = '10000000-0000-4000-8000-000000000001';
const PLAYER_ID = '20000000-0000-4000-8000-000000000001';
const TRANSACTION_ID = '30000000-0000-4000-8000-000000000001';

interface EntityManagerDouble {
  readonly entityManager: EntityManager;
  readonly findOneCalls: Array<{
    entityType: new (...args: never[]) => object;
    where: object;
    options?: object;
  }>;
  readonly findCalls: Array<{
    entityType: new (...args: never[]) => object;
    where: object;
    options: object;
  }>;
  readonly persisted: object[];
  readonly assignments: Array<{ entity: object; data: object }>;
  readonly nativeUpdates: Array<{
    entityType: new (...args: never[]) => object;
    where: object;
    data: object;
  }>;
  readonly refreshed: object[];
  readonly executeCalls: Array<{
    query: string;
    params: readonly unknown[];
    method: string;
  }>;
}

function entityManagerDouble(
  findOneResult: object | null,
  findResult: object[] = [],
  executeResult: object[] = [],
): EntityManagerDouble {
  const findOneCalls: EntityManagerDouble['findOneCalls'] = [];
  const findCalls: EntityManagerDouble['findCalls'] = [];
  const persisted: object[] = [];
  const assignments: EntityManagerDouble['assignments'] = [];
  const nativeUpdates: EntityManagerDouble['nativeUpdates'] = [];
  const refreshed: object[] = [];
  const executeCalls: EntityManagerDouble['executeCalls'] = [];

  const entityManager = {
    async findOne(
      entityType: new (...args: never[]) => object,
      where: object,
      options?: object,
    ) {
      findOneCalls.push({ entityType, where, options });
      return findOneResult;
    },
    async find(
      entityType: new (...args: never[]) => object,
      where: object,
      options: object,
    ) {
      findCalls.push({ entityType, where, options });
      return findResult;
    },
    async execute(
      query: string,
      params: readonly unknown[],
      method: string,
    ) {
      executeCalls.push({ query, params, method });
      return executeResult;
    },
    create(
      entityType: new (...args: never[]) => object,
      data: object,
    ) {
      return Object.assign(new entityType(), data);
    },
    persist(entity: object) {
      persisted.push(entity);
    },
    assign(entity: object, data: object) {
      assignments.push({ entity, data });
      return Object.assign(entity, data);
    },
    async nativeUpdate(
      entityType: new (...args: never[]) => object,
      where: object,
      data: object,
    ) {
      nativeUpdates.push({ entityType, where, data });
      return 1;
    },
    async refresh(entity: object) {
      refreshed.push(entity);
      return entity;
    },
  } as unknown as EntityManager;

  return {
    entityManager,
    findOneCalls,
    findCalls,
    persisted,
    assignments,
    nativeUpdates,
    refreshed,
    executeCalls,
  };
}

function brl(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function wallet(): Wallet {
  return Wallet.open({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    initialBalance: brl('100.00'),
    openedAt: CREATED_AT,
  });
}

function transaction(): WagerTransaction {
  return WagerTransaction.create({
    id: TRANSACTION_ID,
    providerId: 'provider-a',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-a:external-1',
    payloadHash: 'payload-hash',
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: 'round-1',
    gameId: 'game-1',
    kind: WagerTransactionKind.Bet,
    money: brl('25.00'),
    createdAt: CREATED_AT,
  });
}

function transactionRecord(
  domainTransaction = transaction(),
  resultBalance?: Money,
): WagerTransactionRecord {
  return {
    transaction: domainTransaction,
    resultBalance,
    referenceAttempts: 0,
  };
}

function ledgerEntry(): WalletLedgerEntry {
  return WalletLedgerEntry.create({
    id: '40000000-0000-4000-8000-000000000001',
    walletId: WALLET_ID,
    transactionId: TRANSACTION_ID,
    direction: LedgerDirection.Debit,
    money: brl('25.00'),
    balanceBefore: brl('100.00'),
    balanceAfter: brl('75.00'),
    createdAt: UPDATED_AT,
  });
}

function inboxMessage(): InboxMessage {
  return InboxMessage.receive({
    consumerName: 'wager-consumer',
    messageId: 'message-1',
    payloadHash: 'payload-hash',
    receivedAt: CREATED_AT,
  });
}

function outboxMessage(): OutboxMessage {
  return OutboxMessage.rehydrate({
    id: '50000000-0000-4000-8000-000000000001',
    aggregateId: TRANSACTION_ID,
    eventType: 'wager.transaction.processed',
    payload: { eventId: '50000000-0000-4000-8000-000000000001' },
    occurredAt: CREATED_AT,
    attempts: 0,
  });
}

describe('MikroORM repositories', () => {
  test('maps wallet reads and restricts updates to mutable state', async () => {
    const domainWallet = wallet();
    const persistenceEntity = Object.assign(
      new WalletPersistenceEntity(),
      WalletPersistenceMapper.toPersistence(domainWallet),
    );
    const double = entityManagerDouble(persistenceEntity);
    const repository = new MikroOrmWalletRepository(double.entityManager);

    const loadedById = await repository.findById(WALLET_ID);
    const lockedById = await repository.findByIdForUpdate(WALLET_ID);
    const loadedByOwner = await repository.findByPlayerAndCurrency(
      PLAYER_ID,
      'BRL',
    );
    await repository.add(domainWallet);
    domainWallet.debit(brl('25.00'), UPDATED_AT);
    await repository.save(domainWallet);

    expect(loadedById?.balance.toJSON().amount).toBe('100.00');
    expect(lockedById?.balance.toJSON().amount).toBe('100.00');
    expect(loadedByOwner?.playerId).toBe(PLAYER_ID);
    expect(double.findOneCalls.map((call) => call.where)).toEqual([
      { id: WALLET_ID },
      { id: WALLET_ID },
      { playerId: PLAYER_ID, currency: 'BRL' },
      { id: WALLET_ID },
    ]);
    expect(double.findOneCalls[1]?.options).toEqual({
      lockMode: LockMode.PESSIMISTIC_WRITE,
    });
    expect(double.persisted[0]).toBeInstanceOf(WalletPersistenceEntity);
    expect(double.assignments[0]?.data).toEqual({
      balance: '75.00',
      version: 2,
      updatedAt: UPDATED_AT,
    });
  });

  test('supports every required transaction identity and saves only transitions', async () => {
    const domainTransaction = transaction();
    const pendingRecord = transactionRecord(domainTransaction);
    const persistenceEntity = Object.assign(
      new WagerTransactionPersistenceEntity(),
      WagerTransactionPersistenceMapper.toPersistence(pendingRecord),
    );
    const double = entityManagerDouble(persistenceEntity, [], [
      { id: TRANSACTION_ID },
    ]);
    const repository = new MikroOrmWagerTransactionRepository(
      double.entityManager,
    );

    await repository.findById(TRANSACTION_ID);
    await repository.findNextPendingReferenceDueForUpdate(UPDATED_AT);
    await repository.findByIdempotencyKey('provider-a:external-1');
    await repository.findByProviderTransaction('provider-a', 'external-1');
    await repository.findByReferenceAndKind(
      TRANSACTION_ID,
      WagerTransactionKind.Refund,
    );
    await repository.add(pendingRecord);
    domainTransaction.markProcessed(undefined, UPDATED_AT);
    await repository.save(transactionRecord(domainTransaction, brl('75.00')));

    expect(double.findOneCalls.map((call) => call.where)).toEqual([
      { id: TRANSACTION_ID },
      { id: TRANSACTION_ID },
      { idempotencyKey: 'provider-a:external-1' },
      { providerId: 'provider-a', externalTransactionId: 'external-1' },
      {
        referenceTransactionId: TRANSACTION_ID,
        kind: WagerTransactionKind.Refund,
      },
      { id: TRANSACTION_ID },
    ]);
    expect(double.executeCalls).toHaveLength(1);
    expect(double.executeCalls[0]?.query.toLowerCase()).toContain(
      "status = 'pending_reference'",
    );
    expect(double.executeCalls[0]?.query.toLowerCase()).toContain(
      'for update of candidate skip locked',
    );
    expect(double.executeCalls[0]?.params).toEqual([UPDATED_AT]);
    expect(double.persisted[0]).toBeInstanceOf(
      WagerTransactionPersistenceEntity,
    );
    expect(double.nativeUpdates[0]).toEqual({
      entityType: WagerTransactionPersistenceEntity,
      where: { id: TRANSACTION_ID },
      data: {
      status: 'PROCESSED',
      referenceTransactionId: null,
      failureCode: null,
      processedAt: UPDATED_AT,
      resultBalanceAmount: '75.00',
      resultBalanceCurrency: 'BRL',
      referenceAttempts: 0,
      nextReferenceAttemptAt: null,
      },
    });
    expect(double.refreshed).toEqual([persistenceEntity]);
  });

  test('keeps the ledger repository append-only', async () => {
    const domainEntry = ledgerEntry();
    const persistenceEntity = Object.assign(
      new WalletLedgerEntryPersistenceEntity(),
      WalletLedgerEntryPersistenceMapper.toPersistence(domainEntry),
    );
    const double = entityManagerDouble(persistenceEntity, [persistenceEntity]);
    const repository = new MikroOrmWalletLedgerEntryRepository(
      double.entityManager,
    );

    const loaded = await repository.findByWalletAndTransaction(
      WALLET_ID,
      TRANSACTION_ID,
    );
    const before = new Date('2026-10-08T12:10:00.000Z');
    const page = await repository.listByWallet(WALLET_ID, {
      before: { createdAt: before, id: domainEntry.id },
      limit: 51,
    });
    await repository.add(domainEntry);

    expect(loaded?.isBalanced()).toBe(true);
    expect(double.findOneCalls[0]?.where).toEqual({
      walletId: WALLET_ID,
      transactionId: TRANSACTION_ID,
    });
    expect(page[0]?.id).toBe(domainEntry.id);
    expect(double.findCalls[0]?.where).toEqual({
      walletId: WALLET_ID,
      $or: [
        { createdAt: { $lt: before } },
        { createdAt: before, id: { $lt: domainEntry.id } },
      ],
    });
    expect(double.findCalls[0]?.options).toEqual({
      limit: 51,
      orderBy: { createdAt: 'DESC', id: 'DESC' },
    });
    expect(double.persisted[0]).toBeInstanceOf(
      WalletLedgerEntryPersistenceEntity,
    );
    expect(double.assignments).toEqual([]);
  });

  test('persists inbox and outbox state without flushing independently', async () => {
    const inbox = inboxMessage();
    const inboxEntity = Object.assign(
      new InboxMessagePersistenceEntity(),
      InboxMessagePersistenceMapper.toPersistence(inbox),
    );
    const inboxDouble = entityManagerDouble(inboxEntity);
    const inboxRepository = new MikroOrmInboxMessageRepository(
      inboxDouble.entityManager,
    );

    await inboxRepository.findByIdentity('wager-consumer', 'message-1');
    await inboxRepository.add(inbox);
    inbox.markProcessed(UPDATED_AT);
    await inboxRepository.save(inbox);

    const outbox = outboxMessage();
    const outboxEntity = Object.assign(
      new OutboxMessagePersistenceEntity(),
      OutboxMessagePersistenceMapper.toPersistence(outbox),
    );
    const outboxDouble = entityManagerDouble(outboxEntity, [], [
      OutboxMessagePersistenceMapper.toPersistence(outbox),
    ]);
    const outboxRepository = new MikroOrmOutboxMessageRepository(
      outboxDouble.entityManager,
    );

    await outboxRepository.findById(outbox.id);
    expect(await outboxRepository.findDueForUpdate(UPDATED_AT, 10)).toHaveLength(1);
    await outboxRepository.add(outbox);
    outbox.markPublished(UPDATED_AT);
    await outboxRepository.save(outbox);

    expect(inboxDouble.persisted[0]).toBeInstanceOf(
      InboxMessagePersistenceEntity,
    );
    expect(inboxDouble.assignments[0]?.data).toEqual({
      processedAt: UPDATED_AT,
    });
    expect(outboxDouble.persisted[0]).toBeInstanceOf(
      OutboxMessagePersistenceEntity,
    );
    expect(outboxDouble.assignments[0]?.data).toEqual({
      attempts: 0,
      nextAttemptAt: null,
      publishedAt: UPDATED_AT,
    });
    expect(outboxDouble.executeCalls[0]?.query).toContain(
      'for update of candidate skip locked',
    );
    expect(outboxDouble.executeCalls[0]?.query).toContain('not exists');
    expect(outboxDouble.executeCalls[0]?.params).toEqual([UPDATED_AT, 10]);
    expect(outboxDouble.executeCalls[0]?.method).toBe('all');
  });

  test('reads one exact pending-outbox snapshot for metrics', async () => {
    const oldestPendingAt = new Date('2026-10-08T11:59:30.000Z');
    const double = entityManagerDouble(null, [], [
      { pendingMessages: '7', oldestPendingAt },
    ]);
    const repository = new MikroOrmOutboxMessageRepository(
      double.entityManager,
    );

    expect(await repository.getPendingSnapshot()).toEqual({
      pendingMessages: 7,
      oldestPendingAt,
    });
    expect(double.executeCalls[0]?.query).toContain(
      'where published_at is null',
    );
    expect(double.executeCalls[0]?.params).toEqual([]);
    expect(double.executeCalls[0]?.method).toBe('all');
  });

  test('reconciles wallet and ledger from one exact aggregate query', async () => {
    const executeCalls: Array<{
      query: string;
      params: readonly unknown[];
      method: string;
    }> = [];
    const entityManager = {
      async execute(
        query: string,
        params: readonly unknown[],
        method: string,
      ) {
        executeCalls.push({ query, params, method });
        return [
          {
            walletId: WALLET_ID,
            storedBalance: '9007199254740993.12',
            currency: 'BRL',
            calculatedBalance: '9007199254740992.12',
            checkedEntries: '7',
          },
        ];
      },
    } as unknown as EntityManager;
    const repository = new MikroOrmWalletReconciliationRepository(
      entityManager,
    );

    const snapshot = await repository.findByWalletId(WALLET_ID);

    expect(snapshot?.storedBalance.toJSON().amount).toBe(
      '9007199254740993.12',
    );
    expect(snapshot?.calculatedBalance.toJSON().amount).toBe(
      '9007199254740992.12',
    );
    expect(snapshot?.checkedEntries).toBe(7);
    expect(executeCalls).toHaveLength(1);
    expect(executeCalls[0]?.params).toEqual([WALLET_ID]);
    expect(executeCalls[0]?.method).toBe('all');
    expect(executeCalls[0]?.query).toContain('left join wallet_ledger_entries');
    expect(executeCalls[0]?.query).toContain('sum(');
    expect(executeCalls[0]?.query).toContain('count(ledger.id)');
  });

  test('returns no reconciliation snapshot when the wallet does not exist', async () => {
    const entityManager = {
      execute: async () => [],
    } as unknown as EntityManager;
    const repository = new MikroOrmWalletReconciliationRepository(
      entityManager,
    );

    expect(await repository.findByWalletId(WALLET_ID)).toBeUndefined();
  });

  test('rejects a ledger count that cannot be represented exactly', async () => {
    const entityManager = {
      execute: async () => [
        {
          walletId: WALLET_ID,
          storedBalance: '10.00',
          currency: 'BRL',
          calculatedBalance: '10.00',
          checkedEntries: '9007199254740993',
        },
      ],
    } as unknown as EntityManager;
    const repository = new MikroOrmWalletReconciliationRepository(
      entityManager,
    );

    await expect(repository.findByWalletId(WALLET_ID)).rejects.toThrow(
      'PostgreSQL returned an invalid ledger entry count',
    );
  });

  test('fails explicitly instead of silently inserting during save', async () => {
    const repository = new MikroOrmWalletRepository(
      entityManagerDouble(null).entityManager,
    );

    let error: unknown;
    try {
      await repository.save(wallet());
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(PersistenceRecordNotFoundError);
    expect((error as Error).message).toContain(WALLET_ID);
  });
});

describe('MikroOrmUnitOfWork', () => {
  test('binds all repositories to the transaction-scoped EntityManager', async () => {
    const transactionManager = entityManagerDouble(null).entityManager;
    let transactionalCalls = 0;
    const orm = {
      em: {
        async transactional<T>(
          work: (entityManager: EntityManager) => Promise<T>,
        ): Promise<T> {
          transactionalCalls += 1;
          return work(transactionManager);
        },
      },
    } as unknown as MikroORM;
    const unitOfWork = new MikroOrmUnitOfWork(orm);

    const result = await unitOfWork.execute(async (repositories) => {
      expect(Object.isFrozen(repositories)).toBe(true);
      expect(repositories.wallets).toBeInstanceOf(MikroOrmWalletRepository);
      expect(repositories.walletReconciliations).toBeInstanceOf(
        MikroOrmWalletReconciliationRepository,
      );
      expect(repositories.wagerTransactions).toBeInstanceOf(
        MikroOrmWagerTransactionRepository,
      );
      expect(repositories.walletLedgerEntries).toBeInstanceOf(
        MikroOrmWalletLedgerEntryRepository,
      );
      expect(repositories.inboxMessages).toBeInstanceOf(
        MikroOrmInboxMessageRepository,
      );
      expect(repositories.outboxMessages).toBeInstanceOf(
        MikroOrmOutboxMessageRepository,
      );

      await repositories.wallets.findById(WALLET_ID);
      return 'committed-result';
    });

    expect(result).toBe('committed-result');
    expect(transactionalCalls).toBe(1);
  });

  test('propagates callback failures through the ORM transaction boundary', async () => {
    const expectedError = new Error('force rollback');
    const orm = {
      em: {
        async transactional<T>(
          work: (entityManager: EntityManager) => Promise<T>,
        ): Promise<T> {
          return work(entityManagerDouble(null).entityManager);
        },
      },
    } as unknown as MikroORM;
    const unitOfWork = new MikroOrmUnitOfWork(orm);

    let error: unknown;
    try {
      await unitOfWork.execute(async () => {
        throw expectedError;
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBe(expectedError);
  });
});
