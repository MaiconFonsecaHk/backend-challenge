import { describe, expect, test } from 'bun:test';
import {
  DeadlockException,
  LockWaitTimeoutException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';

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

  test('matches only the wallet player-and-currency constraint', () => {
    expect(
      classifier.isWalletIdentityConflict(
        uniqueViolation('wallets_player_id_currency_unique'),
      ),
    ).toBe(true);
    expect(
      classifier.isWalletIdentityConflict(
        uniqueViolation('wager_transactions_idempotency_key_unique'),
      ),
    ).toBe(false);
    expect(
      classifier.isWalletIdentityConflict(new Error('not a DB conflict')),
    ).toBe(false);
  });

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

  test('matches only the provider transaction identity constraint', () => {
    expect(
      classifier.isWagerProviderTransactionConflict(
        uniqueViolation('wager_transactions_provider_external_unique'),
      ),
    ).toBe(true);
    expect(
      classifier.isWagerProviderTransactionConflict(
        uniqueViolation('wager_transactions_idempotency_key_unique'),
      ),
    ).toBe(false);
    expect(
      classifier.isWagerProviderTransactionConflict(
        new Error('not a DB conflict'),
      ),
    ).toBe(false);
  });

  test('matches only the inbox composite primary-key constraint', () => {
    expect(
      classifier.isInboxIdentityConflict(
        uniqueViolation('inbox_messages_pkey'),
      ),
    ).toBe(true);
    expect(
      classifier.isInboxIdentityConflict(
        uniqueViolation('wager_transactions_idempotency_key_unique'),
      ),
    ).toBe(false);
    expect(
      classifier.isInboxIdentityConflict(new Error('not a DB conflict')),
    ).toBe(false);
  });

  test('recognizes deadlocks and lock-wait timeouts as contention', () => {
    expect(classifier.isLockConflict(new DeadlockException(new Error()))).toBe(
      true,
    );
    expect(
      classifier.isLockConflict(new LockWaitTimeoutException(new Error())),
    ).toBe(true);
    expect(classifier.isLockConflict(new Error('ordinary failure'))).toBe(
      false,
    );
  });
});
