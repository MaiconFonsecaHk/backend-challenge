import { UniqueConstraintViolationException } from '@mikro-orm/core';

import type { PersistenceConflictClassifier } from '../../application/ports/persistence/persistence-conflict-classifier.js';

const WAGER_IDEMPOTENCY_CONSTRAINT =
  'wager_transactions_idempotency_key_unique';

interface ConstraintError {
  readonly constraint?: unknown;
}

export class MikroOrmPersistenceConflictClassifier
  implements PersistenceConflictClassifier
{
  isWagerIdempotencyKeyConflict(error: unknown): boolean {
    return (
      error instanceof UniqueConstraintViolationException &&
      (error as ConstraintError).constraint === WAGER_IDEMPOTENCY_CONSTRAINT
    );
  }
}
