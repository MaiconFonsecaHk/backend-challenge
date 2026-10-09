import { describe, expect, test } from 'bun:test';

import { WagerTransactionProcessed } from '../../../src/domain/events/wager-transaction.events.js';
import {
  InvalidOutboxRetryScheduleError,
  InvalidOutboxTimestampError,
  OutboxAlreadyPublishedError,
} from '../../../src/domain/messaging/outbox-message.error.js';
import {
  OutboxMessage,
  type OutboxRetryPolicy,
} from '../../../src/domain/messaging/outbox-message.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
} from '../../../src/domain/wagering/wager-transaction.js';

const OCCURRED_AT = new Date('2026-10-07T17:00:00.000Z');

function processedEvent(): WagerTransactionProcessed {
  const transaction = WagerTransaction.create({
    id: 'transaction-id',
    providerId: 'provider-a',
    externalTransactionId: 'external-id',
    idempotencyKey: 'provider-a:external-id',
    payloadHash: 'payload-hash',
    walletId: 'wallet-id',
    playerId: 'player-id',
    roundId: 'round-id',
    gameId: 'game-id',
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: '10.00', currency: 'BRL' }),
    createdAt: new Date('2026-10-07T16:59:00.000Z'),
  });
  transaction.markProcessed(undefined, OCCURRED_AT);

  return WagerTransactionProcessed.from(transaction, {
    eventId: 'event-id',
    correlationId: 'correlation-id',
    occurredAt: OCCURRED_AT,
  });
}

describe('OutboxMessage', () => {
  test('enqueues the complete serialized event as an immediately pending message', () => {
    const message = OutboxMessage.enqueue(processedEvent());

    expect(message.id).toBe('event-id');
    expect(message.aggregateId).toBe('transaction-id');
    expect(message.eventType).toBe('WagerTransactionProcessed');
    expect(message.occurredAt).toEqual(OCCURRED_AT);
    expect(message.attempts).toBe(0);
    expect(message.nextAttemptAt).toBeUndefined();
    expect(message.publishedAt).toBeUndefined();
    expect(message.isPending()).toBe(true);
    expect(message.isDue(OCCURRED_AT)).toBe(true);
    expect(message.payload).toMatchObject({
      eventId: 'event-id',
      eventType: 'WagerTransactionProcessed',
      aggregateId: 'transaction-id',
      occurredAt: '2026-10-07T17:00:00.000Z',
      version: 1,
    });
    expect(Object.isFrozen(message.payload)).toBe(true);
    expect(Object.isFrozen(message.payload.data)).toBe(true);
  });

  test('schedules retries through an injected policy and increments attempts afterward', () => {
    const message = OutboxMessage.enqueue(processedEvent());
    const failedAt = new Date('2026-10-07T17:01:00.000Z');
    const observedAttempts: number[] = [];
    const policy: OutboxRetryPolicy = {
      nextAttemptAt(attempt, policyFailedAt) {
        observedAttempts.push(attempt);
        return new Date(policyFailedAt.getTime() + attempt * 1_000);
      },
    };

    message.scheduleRetry(failedAt, policy);
    expect(message.attempts).toBe(1);
    expect(message.nextAttemptAt).toEqual(new Date('2026-10-07T17:01:01.000Z'));
    expect(message.isDue(new Date('2026-10-07T17:01:00.999Z'))).toBe(false);
    expect(message.isDue(new Date('2026-10-07T17:01:01.000Z'))).toBe(true);

    message.scheduleRetry(new Date('2026-10-07T17:02:00.000Z'), policy);
    expect(message.attempts).toBe(2);
    expect(message.nextAttemptAt).toEqual(new Date('2026-10-07T17:02:02.000Z'));
    expect(observedAttempts).toEqual([1, 2]);
  });

  test('rejects an invalid retry schedule without incrementing attempts', () => {
    const message = OutboxMessage.enqueue(processedEvent());
    const failedAt = new Date('2026-10-07T17:01:00.000Z');
    const pastPolicy: OutboxRetryPolicy = {
      nextAttemptAt: () => new Date('2026-10-07T17:00:59.999Z'),
    };
    const invalidPolicy: OutboxRetryPolicy = {
      nextAttemptAt: () => new Date('invalid'),
    };

    expect(() => message.scheduleRetry(failedAt, pastPolicy)).toThrow(
      InvalidOutboxRetryScheduleError,
    );
    expect(() => message.scheduleRetry(failedAt, invalidPolicy)).toThrow(
      InvalidOutboxTimestampError,
    );
    expect(message.attempts).toBe(0);
    expect(message.nextAttemptAt).toBeUndefined();
  });

  test('protects retry policy and exposed timestamps from external mutation', () => {
    const message = OutboxMessage.enqueue(processedEvent());
    const failedAt = new Date('2026-10-07T17:01:00.000Z');
    const policy: OutboxRetryPolicy = {
      nextAttemptAt(_attempt, policyFailedAt) {
        policyFailedAt.setUTCFullYear(2030);
        return new Date('2026-10-07T17:02:00.000Z');
      },
    };

    message.scheduleRetry(failedAt, policy);
    failedAt.setUTCFullYear(2031);
    message.nextAttemptAt?.setUTCFullYear(2032);

    expect(message.nextAttemptAt).toEqual(new Date('2026-10-07T17:02:00.000Z'));
    expect(message.occurredAt).toEqual(OCCURRED_AT);
  });

  test('marks a pending message as published and clears its retry schedule', () => {
    const message = OutboxMessage.enqueue(processedEvent());
    message.scheduleRetry(new Date('2026-10-07T17:01:00.000Z'), {
      nextAttemptAt: () => new Date('2026-10-07T17:02:00.000Z'),
    });
    const publishedAt = new Date('2026-10-07T17:03:00.000Z');

    message.markPublished(publishedAt);
    publishedAt.setUTCFullYear(2030);

    expect(message.isPending()).toBe(false);
    expect(message.isDue(new Date('2026-10-07T18:00:00.000Z'))).toBe(false);
    expect(message.publishedAt).toEqual(new Date('2026-10-07T17:03:00.000Z'));
    expect(message.nextAttemptAt).toBeUndefined();
    expect(message.attempts).toBe(1);
  });

  test('prevents published messages from being published or scheduled again', () => {
    const message = OutboxMessage.enqueue(processedEvent());
    message.markPublished(new Date('2026-10-07T17:03:00.000Z'));

    expect(() => message.markPublished(new Date('2026-10-07T17:04:00.000Z'))).toThrow(
      OutboxAlreadyPublishedError,
    );
    expect(() =>
      message.scheduleRetry(new Date('2026-10-07T17:04:00.000Z'), {
        nextAttemptAt: () => new Date('2026-10-07T17:05:00.000Z'),
      }),
    ).toThrow(OutboxAlreadyPublishedError);
  });

  test('rejects invalid operational timestamps without changing state', () => {
    const message = OutboxMessage.enqueue(processedEvent());

    expect(() => message.isDue(new Date('invalid'))).toThrow(InvalidOutboxTimestampError);
    expect(() => message.markPublished(new Date('invalid'))).toThrow(InvalidOutboxTimestampError);
    expect(() =>
      message.scheduleRetry(new Date('invalid'), {
        nextAttemptAt: () => new Date('2026-10-07T17:05:00.000Z'),
      }),
    ).toThrow(InvalidOutboxTimestampError);
    expect(message.attempts).toBe(0);
    expect(message.isPending()).toBe(true);
  });

  test('rehydrates persisted publication state and deep-copies its payload', () => {
    const payload = {
      eventId: 'event-id',
      data: { nested: { value: 'original' } },
    };
    const occurredAt = new Date(OCCURRED_AT.getTime());
    const nextAttemptAt = new Date('2026-10-07T17:02:00.000Z');
    const publishedAt = new Date('2026-10-07T17:03:00.000Z');
    const message = OutboxMessage.rehydrate({
      id: 'event-id',
      aggregateId: 'transaction-id',
      eventType: 'WagerTransactionProcessed',
      payload,
      occurredAt,
      attempts: 2,
      nextAttemptAt,
      publishedAt,
    });

    payload.data.nested.value = 'mutated';
    occurredAt.setUTCFullYear(2030);
    nextAttemptAt.setUTCFullYear(2030);
    publishedAt.setUTCFullYear(2030);

    expect(message.payload).toEqual({
      eventId: 'event-id',
      data: { nested: { value: 'original' } },
    });
    expect(Object.isFrozen(message.payload.data)).toBe(true);
    expect(message.occurredAt).toEqual(OCCURRED_AT);
    expect(message.nextAttemptAt).toEqual(new Date('2026-10-07T17:02:00.000Z'));
    expect(message.publishedAt).toEqual(new Date('2026-10-07T17:03:00.000Z'));
    expect(message.attempts).toBe(2);
    expect(message.isPending()).toBe(false);
  });

  test('exposes stable error codes for outbox invariant violations', () => {
    expect(new InvalidOutboxTimestampError().code).toBe('INVALID_OUTBOX_TIMESTAMP');
    expect(new OutboxAlreadyPublishedError().code).toBe('OUTBOX_ALREADY_PUBLISHED');
    expect(new InvalidOutboxRetryScheduleError().code).toBe(
      'INVALID_OUTBOX_RETRY_SCHEDULE',
    );
  });
});
