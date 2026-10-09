import { describe, expect, test } from 'bun:test';

import { PendingReferenceRetryPolicy } from '../../../src/application/services/pending-reference-retry.policy.js';

const CREATED_AT = new Date('2026-10-09T10:00:00.000Z');

describe('PendingReferenceRetryPolicy', () => {
  test('backs off exponentially, caps the delay, and never schedules after expiry', () => {
    const policy = new PendingReferenceRetryPolicy(30, 120, 300);

    expect(policy.nextRetry(0, CREATED_AT, CREATED_AT)).toEqual({
      attempts: 1,
      nextAttemptAt: new Date('2026-10-09T10:00:30.000Z'),
    });
    expect(
      policy.nextRetry(
        1,
        CREATED_AT,
        new Date('2026-10-09T10:00:30.000Z'),
      ),
    ).toEqual({
      attempts: 2,
      nextAttemptAt: new Date('2026-10-09T10:01:30.000Z'),
    });
    expect(
      policy.nextRetry(
        4,
        CREATED_AT,
        new Date('2026-10-09T10:04:30.000Z'),
      ),
    ).toEqual({
      attempts: 5,
      nextAttemptAt: new Date('2026-10-09T10:05:00.000Z'),
    });
    expect(
      policy.nextRetry(
        5,
        CREATED_AT,
        new Date('2026-10-09T10:05:00.000Z'),
      ),
    ).toBeUndefined();
  });

  test('rejects invalid limits, attempts, and timestamps', () => {
    expect(() => new PendingReferenceRetryPolicy(0, 120, 300)).toThrow();
    expect(() => new PendingReferenceRetryPolicy(30, 20, 300)).toThrow();
    expect(() => new PendingReferenceRetryPolicy(30, 120, 60)).toThrow();

    const policy = new PendingReferenceRetryPolicy(30, 120, 300);
    expect(() => policy.nextRetry(-1, CREATED_AT, CREATED_AT)).toThrow();
    expect(() =>
      policy.nextRetry(Number.MAX_SAFE_INTEGER, CREATED_AT, CREATED_AT),
    ).toThrow();
    expect(() =>
      policy.nextRetry(
        0,
        CREATED_AT,
        new Date('2026-10-09T09:59:59.000Z'),
      ),
    ).toThrow();
    expect(() =>
      policy.nextRetry(0, CREATED_AT, new Date('invalid')),
    ).toThrow();
  });
});
