import { describe, expect, test } from 'bun:test';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import { MikroOrmPersistenceConflictClassifier } from '../../../src/infrastructure/persistence/mikro-orm-persistence-conflict.classifier.js';

function uniqueViolation(constraint: string): UniqueConstraintViolationException {
  return new UniqueConstraintViolationException(
    Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint,
    }),
  );
}

describe('MikroOrmPersistenceConflictClassifier', () => {
  const classifier = new MikroOrmPersistenceConflictClassifier();

  test('matches only the wager idempotency-key constraint', () => {
    expect(
      classifier.isWagerIdempotencyKeyConflict(
        uniqueViolation('wager_transactions_idempotency_key_unique'),
      ),
    ).toBe(true);
    expect(
      classifier.isWagerIdempotencyKeyConflict(
        uniqueViolation('wager_transactions_provider_external_unique'),
      ),
    ).toBe(false);
    expect(
      classifier.isWagerIdempotencyKeyConflict(new Error('not a DB conflict')),
    ).toBe(false);
  });
});
