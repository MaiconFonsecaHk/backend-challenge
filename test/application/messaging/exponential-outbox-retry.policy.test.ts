import { describe, expect, test } from 'bun:test';

import { ExponentialOutboxRetryPolicy } from '../../../src/application/services/exponential-outbox-retry.policy.js';

const FAILED_AT = new Date('2026-10-09T12:00:00.000Z');

describe('ExponentialOutboxRetryPolicy', () => {
  test('doubles the delay by attempt and caps it at the configured maximum', () => {
    const policy = new ExponentialOutboxRetryPolicy(5, 300);

    expect(policy.nextAttemptAt(1, FAILED_AT)).toEqual(
      new Date('2026-10-09T12:00:05.000Z'),
    );
    expect(policy.nextAttemptAt(2, FAILED_AT)).toEqual(
      new Date('2026-10-09T12:00:10.000Z'),
    );
    expect(policy.nextAttemptAt(7, FAILED_AT)).toEqual(
      new Date('2026-10-09T12:05:00.000Z'),
    );
    expect(policy.nextAttemptAt(30, FAILED_AT)).toEqual(
      new Date('2026-10-09T12:05:00.000Z'),
    );
  });

  test('rejects non-positive or inverted configuration', () => {
    expect(() => new ExponentialOutboxRetryPolicy(0, 300)).toThrow();
    expect(() => new ExponentialOutboxRetryPolicy(10, 5)).toThrow();
  });
});
