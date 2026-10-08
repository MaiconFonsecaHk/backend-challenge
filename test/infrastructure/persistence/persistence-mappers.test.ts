import { describe, expect, test } from 'bun:test';

import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';
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

const CREATED_AT = new Date('2026-10-08T12:00:00.000Z');
const UPDATED_AT = new Date('2026-10-08T12:05:00.000Z');
const WALLET_ID = '10000000-0000-4000-8000-000000000001';
const PLAYER_ID = '20000000-0000-4000-8000-000000000001';
const TRANSACTION_ID = '30000000-0000-4000-8000-000000000001';

describe('persistence mappers', () => {
  test('rehydrates and serializes a wallet without converting money to number', () => {
    const entity = Object.assign(new WalletPersistenceEntity(), {
      id: WALLET_ID,
      playerId: PLAYER_ID,
      currency: 'BRL',
      balance: '9007199254740993.5',
      version: 2,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });

    const wallet = WalletPersistenceMapper.toDomain(entity);
    const persisted = WalletPersistenceMapper.toPersistence(wallet);

    expect(wallet.balance.toJSON()).toEqual({
      amount: '9007199254740993.50',
      currency: 'BRL',
    });
    expect(persisted).toEqual({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      currency: 'BRL',
      balance: '9007199254740993.50',
      version: 2,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
    expect(typeof persisted.balance).toBe('string');
  });

  test('rehydrates and serializes transaction domain state explicitly', () => {
    const entity = Object.assign(new WagerTransactionPersistenceEntity(), {
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
      status: WagerTransactionStatus.Processed,
      amount: '25.5',
      currency: 'BRL',
      referenceExternalTransactionId: null,
      referenceTransactionId: null,
      failureCode: null,
      processedAt: UPDATED_AT,
      resultBalanceAmount: '74.50',
      resultBalanceCurrency: 'BRL',
      referenceAttempts: 0,
      nextReferenceAttemptAt: null,
      createdAt: CREATED_AT,
    });

    const record = WagerTransactionPersistenceMapper.toRecord(entity);
    const persisted = WagerTransactionPersistenceMapper.toPersistence(record);

    expect(record.transaction.money.toJSON()).toEqual({
      amount: '25.50',
      currency: 'BRL',
    });
    expect(record.transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(record.transaction.processedAt).toEqual(UPDATED_AT);
    expect(record.resultBalance?.toJSON()).toEqual({
      amount: '74.50',
      currency: 'BRL',
    });
    expect(record.referenceAttempts).toBe(0);
    expect(record.nextReferenceAttemptAt).toBeUndefined();
    expect(persisted.amount).toBe('25.50');
    expect(persisted.resultBalanceAmount).toBe('74.50');
    expect(persisted.resultBalanceCurrency).toBe('BRL');
    expect(persisted.referenceExternalTransactionId).toBeNull();
    expect(persisted.referenceTransactionId).toBeNull();
    expect(persisted.failureCode).toBeNull();
  });

  test('rehydrates a ledger entry while preserving exact balanced arithmetic', () => {
    const entity = Object.assign(new WalletLedgerEntryPersistenceEntity(), {
      id: '40000000-0000-4000-8000-000000000001',
      walletId: WALLET_ID,
      transactionId: TRANSACTION_ID,
      direction: LedgerDirection.Debit,
      amount: '10',
      balanceBefore: '100.5',
      balanceAfter: '90.5',
      currency: 'BRL',
      createdAt: UPDATED_AT,
    });

    const entry = WalletLedgerEntryPersistenceMapper.toDomain(entity);
    const persisted = WalletLedgerEntryPersistenceMapper.toPersistence(entry);

    expect(entry.isBalanced()).toBe(true);
    expect(entry.money.toJSON()).toEqual({ amount: '10.00', currency: 'BRL' });
    expect(entry.balanceBefore.toJSON()).toEqual({
      amount: '100.50',
      currency: 'BRL',
    });
    expect(persisted).toMatchObject({
      amount: '10.00',
      balanceBefore: '100.50',
      balanceAfter: '90.50',
      currency: 'BRL',
    });
  });

  test('rehydrates inbox processing state and maps missing timestamps to null', () => {
    const entity = Object.assign(new InboxMessagePersistenceEntity(), {
      consumerName: 'wager-consumer',
      messageId: 'message-1',
      payloadHash: 'payload-hash',
      receivedAt: CREATED_AT,
      processedAt: null,
    });

    const message = InboxMessagePersistenceMapper.toDomain(entity);
    const persisted = InboxMessagePersistenceMapper.toPersistence(message);

    expect(message.isProcessed()).toBe(false);
    expect(persisted.processedAt).toBeNull();
    expect(persisted).toMatchObject({
      consumerName: 'wager-consumer',
      messageId: 'message-1',
      payloadHash: 'payload-hash',
    });
  });

  test('rehydrates outbox state without exposing mutable payload data', () => {
    const payload = {
      eventId: '50000000-0000-4000-8000-000000000001',
      data: { amount: '25.00', currency: 'BRL' },
    };
    const entity = Object.assign(new OutboxMessagePersistenceEntity(), {
      id: '50000000-0000-4000-8000-000000000001',
      aggregateId: TRANSACTION_ID,
      eventType: 'wager.transaction.processed',
      payload,
      occurredAt: CREATED_AT,
      attempts: 1,
      nextAttemptAt: UPDATED_AT,
      publishedAt: null,
    });

    const message = OutboxMessagePersistenceMapper.toDomain(entity);
    const persisted = OutboxMessagePersistenceMapper.toPersistence(message);

    payload.data.amount = '999.00';

    expect(message.payload).toMatchObject({
      data: { amount: '25.00', currency: 'BRL' },
    });
    expect(Object.isFrozen(message.payload)).toBe(true);
    expect(persisted.attempts).toBe(1);
    expect(persisted.nextAttemptAt).toEqual(UPDATED_AT);
    expect(persisted.publishedAt).toBeNull();
  });

  test('serializes domain money directly from its canonical string form', () => {
    const money = Money.from({ amount: '0.10', currency: 'BRL' });

    expect(money.toJSON()).toEqual({ amount: '0.10', currency: 'BRL' });
  });
});
