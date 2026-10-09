import { describe, expect, test } from 'bun:test';

import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';
import {
  InvalidIntegrationEventIdentityError,
  InvalidIntegrationEventSourceError,
  InvalidIntegrationEventTimestampError,
} from '../../../src/domain/events/integration-event.error.js';
import {
  type EventContext,
  IntegrationEvent,
  type IntegrationEventProps,
} from '../../../src/domain/events/integration-event.js';
import {
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '../../../src/domain/events/wager-transaction.events.js';
import { WalletBalanceChanged } from '../../../src/domain/events/wallet-balance-changed.event.js';
import { InvalidJsonPayloadError } from '../../../src/domain/shared/serialization/immutable-json.error.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../../src/domain/wagering/wager-transaction.js';

const OCCURRED_AT = new Date('2026-10-07T16:00:00.000Z');
const CONTEXT: EventContext = {
  eventId: 'event-id',
  correlationId: 'correlation-id',
  causationId: 'causation-id',
  occurredAt: OCCURRED_AT,
};

interface TestEventData {
  readonly value: unknown;
}

class TestEvent extends IntegrationEvent<TestEventData> {
  readonly eventType = 'TestEvent';
  readonly version = 1;

  constructor(props: IntegrationEventProps<TestEventData>) {
    super(props);
    Object.freeze(this);
  }
}

function money(amount = '10.00'): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function createTransaction(kind = WagerTransactionKind.Bet): WagerTransaction {
  const referenceExternalTransactionId =
    kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
      ? 'reference-external'
      : undefined;

  return WagerTransaction.create({
    id: 'transaction-id',
    providerId: 'provider-a',
    externalTransactionId: 'external-id',
    idempotencyKey: 'provider-a:external-id',
    payloadHash: 'payload-hash',
    walletId: 'wallet-id',
    playerId: 'player-id',
    roundId: 'round-id',
    gameId: 'game-id',
    kind,
    money: money(),
    referenceExternalTransactionId,
    createdAt: new Date('2026-10-07T15:59:00.000Z'),
  });
}

describe('IntegrationEvent', () => {
  test('serializes a stable, immutable, versioned envelope', () => {
    const source = { nested: { value: 'original' } };
    const event = new TestEvent({
      ...CONTEXT,
      aggregateId: 'aggregate-id',
      data: { value: source },
    });

    source.nested.value = 'mutated';
    const envelope = event.toJSON();

    expect(envelope).toEqual({
      eventId: 'event-id',
      eventType: 'TestEvent',
      aggregateId: 'aggregate-id',
      correlationId: 'correlation-id',
      causationId: 'causation-id',
      occurredAt: '2026-10-07T16:00:00.000Z',
      version: 1,
      data: { value: { nested: { value: 'original' } } },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.data)).toBe(true);
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.data)).toBe(true);
    expect(JSON.parse(JSON.stringify(envelope))).toEqual(envelope);
  });

  test('omits causationId when there is no causing message or event', () => {
    const event = new TestEvent({
      eventId: 'event-id',
      aggregateId: 'aggregate-id',
      correlationId: 'correlation-id',
      occurredAt: OCCURRED_AT,
      data: { value: 'value' },
    });

    expect(event.toJSON()).not.toHaveProperty('causationId');
  });

  test('protects event time from external Date mutation', () => {
    const occurredAt = new Date(OCCURRED_AT.getTime());
    const event = new TestEvent({
      eventId: 'event-id',
      aggregateId: 'aggregate-id',
      correlationId: 'correlation-id',
      occurredAt,
      data: { value: 'value' },
    });

    occurredAt.setUTCFullYear(2030);
    event.occurredAt.setUTCFullYear(2031);

    expect(event.occurredAt).toEqual(OCCURRED_AT);
  });

  test.each([
    { eventId: '', aggregateId: 'aggregate', correlationId: 'correlation' },
    { eventId: 'event', aggregateId: '   ', correlationId: 'correlation' },
    { eventId: 'event', aggregateId: 'aggregate', correlationId: '' },
  ])('rejects an empty event identity: %o', (identity) => {
    expect(() =>
      new TestEvent({ ...identity, occurredAt: OCCURRED_AT, data: { value: 'value' } }),
    ).toThrow(InvalidIntegrationEventIdentityError);
  });

  test('rejects an empty causation id and invalid occurrence time', () => {
    expect(() =>
      new TestEvent({
        eventId: 'event-id',
        aggregateId: 'aggregate-id',
        correlationId: 'correlation-id',
        causationId: '   ',
        occurredAt: OCCURRED_AT,
        data: { value: 'value' },
      }),
    ).toThrow(InvalidIntegrationEventIdentityError);
    expect(() =>
      new TestEvent({
        eventId: 'event-id',
        aggregateId: 'aggregate-id',
        correlationId: 'correlation-id',
        occurredAt: new Date('invalid'),
        data: { value: 'value' },
      }),
    ).toThrow(InvalidIntegrationEventTimestampError);
  });

  test.each([NaN, Infinity, undefined, money()])(
    'rejects data that cannot become a stable plain JSON payload: %o',
    (value) => {
      expect(() =>
        new TestEvent({
          eventId: 'event-id',
          aggregateId: 'aggregate-id',
          correlationId: 'correlation-id',
          occurredAt: OCCURRED_AT,
          data: { value },
        }),
      ).toThrow(InvalidJsonPayloadError);
    },
  );
});

describe('Wager transaction integration events', () => {
  test('creates a processed event with MoneyProps instead of a Money instance', () => {
    const transaction = createTransaction();
    transaction.markProcessed(undefined, OCCURRED_AT);

    const event = WagerTransactionProcessed.from(transaction, CONTEXT);
    const envelope = event.toJSON();

    expect(event.eventType).toBe('WagerTransactionProcessed');
    expect(event.version).toBe(1);
    expect(event.aggregateId).toBe('transaction-id');
    expect(envelope.data).toMatchObject({
      transactionId: 'transaction-id',
      kind: WagerTransactionKind.Bet,
      status: 'PROCESSED',
      money: { amount: '10.00', currency: 'BRL' },
    });
    expect(envelope.data.money).not.toBeInstanceOf(Money);
    expect(Object.isFrozen(envelope.data.money)).toBe(true);
  });

  test('creates a processed event for LOSS even though it does not affect balance', () => {
    const transaction = createTransaction(WagerTransactionKind.Loss);
    transaction.markProcessed(undefined, OCCURRED_AT);

    expect(WagerTransactionProcessed.from(transaction, CONTEXT).data.kind).toBe(
      WagerTransactionKind.Loss,
    );
  });

  test('creates a rejected event carrying its stable failure code', () => {
    const transaction = createTransaction();
    transaction.reject('INSUFFICIENT_FUNDS', OCCURRED_AT);

    const event = WagerTransactionRejected.from(transaction, CONTEXT);

    expect(event.eventType).toBe('WagerTransactionRejected');
    expect(event.data).toMatchObject({
      transactionId: 'transaction-id',
      status: 'REJECTED',
      failureCode: 'INSUFFICIENT_FUNDS',
    });
  });

  test('creates a pending-reference event carrying the unresolved external id', () => {
    const transaction = createTransaction(WagerTransactionKind.Refund);
    transaction.markPendingReference();

    const event = WagerTransactionPendingReference.from(transaction, CONTEXT);

    expect(event.eventType).toBe('WagerTransactionPendingReference');
    expect(event.data).toMatchObject({
      transactionId: 'transaction-id',
      status: 'PENDING_REFERENCE',
      referenceExternalTransactionId: 'reference-external',
    });
  });

  test('rejects event creation from a transaction in the wrong state', () => {
    const pending = createTransaction();
    const processed = createTransaction();
    processed.markProcessed(undefined, OCCURRED_AT);

    expect(() => WagerTransactionProcessed.from(pending, CONTEXT)).toThrow(
      InvalidIntegrationEventSourceError,
    );
    expect(() => WagerTransactionRejected.from(pending, CONTEXT)).toThrow(
      InvalidIntegrationEventSourceError,
    );
    expect(() => WagerTransactionPendingReference.from(processed, CONTEXT)).toThrow(
      InvalidIntegrationEventSourceError,
    );
  });
});

describe('WalletBalanceChanged', () => {
  test('serializes the exact wallet movement using MoneyProps', () => {
    const wallet = Wallet.open({
      id: 'wallet-id',
      playerId: 'player-id',
      initialBalance: money('100.00'),
      openedAt: new Date('2026-10-07T15:00:00.000Z'),
    });
    const change = wallet.debit(money('25.00'), OCCURRED_AT);
    const entry = WalletLedgerEntry.create({
      id: 'ledger-id',
      walletId: wallet.id,
      transactionId: 'transaction-id',
      direction: change.direction,
      money: change.money,
      balanceBefore: change.balanceBefore,
      balanceAfter: change.balanceAfter,
      createdAt: OCCURRED_AT,
    });

    const event = WalletBalanceChanged.from(wallet, entry, CONTEXT);

    expect(event.eventType).toBe('WalletBalanceChanged');
    expect(event.aggregateId).toBe('wallet-id');
    expect(event.data).toEqual({
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Debit,
      money: { amount: '25.00', currency: 'BRL' },
      balanceBefore: { amount: '100.00', currency: 'BRL' },
      balanceAfter: { amount: '75.00', currency: 'BRL' },
      walletVersion: 2,
    });
    expect(event.data.money).not.toBeInstanceOf(Money);
  });

  test('rejects mismatched, unbalanced, or stale wallet sources', () => {
    const wallet = Wallet.open({
      id: 'wallet-id',
      playerId: 'player-id',
      initialBalance: money('100.00'),
      openedAt: OCCURRED_AT,
    });
    const anotherWalletEntry = WalletLedgerEntry.create({
      id: 'ledger-1',
      walletId: 'another-wallet',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Debit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
      createdAt: OCCURRED_AT,
    });
    const unbalancedEntry = WalletLedgerEntry.rehydrate({
      id: 'ledger-2',
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Debit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('80.00'),
      createdAt: OCCURRED_AT,
    });
    const staleEntry = WalletLedgerEntry.create({
      id: 'ledger-3',
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Debit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
      createdAt: OCCURRED_AT,
    });
    const wrongCurrencyWallet = Wallet.open({
      id: 'wallet-id',
      playerId: 'player-id',
      initialBalance: Money.from({ amount: '75.00', currency: 'USD' }),
      openedAt: OCCURRED_AT,
    });

    expect(() => WalletBalanceChanged.from(wallet, anotherWalletEntry, CONTEXT)).toThrow(
      InvalidIntegrationEventSourceError,
    );
    expect(() => WalletBalanceChanged.from(wallet, unbalancedEntry, CONTEXT)).toThrow(
      InvalidIntegrationEventSourceError,
    );
    expect(() => WalletBalanceChanged.from(wallet, staleEntry, CONTEXT)).toThrow(
      InvalidIntegrationEventSourceError,
    );
    expect(() => WalletBalanceChanged.from(wrongCurrencyWallet, staleEntry, CONTEXT)).toThrow(
      InvalidIntegrationEventSourceError,
    );
  });
});
