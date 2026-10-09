import {
  DeadlockException,
  LockWaitTimeoutException,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';

import type { PersistenceConflictClassifier } from '../../application/ports/persistence/persistence-conflict-classifier.js';
import type { WalletPersistenceConflictClassifier } from '../../application/ports/persistence/wallet-persistence-conflict-classifier.js';

const WALLET_IDENTITY_CONSTRAINT = 'wallets_player_id_currency_unique';
const WAGER_IDEMPOTENCY_CONSTRAINT =
  'wager_transactions_idempotency_key_unique';
const WAGER_PROVIDER_TRANSACTION_CONSTRAINT =
  'wager_transactions_provider_external_unique';
const INBOX_IDENTITY_CONSTRAINT = 'inbox_messages_pkey';

interface ConstraintError {
  readonly constraint?: unknown;
}

export class MikroOrmPersistenceConflictClassifier
  implements
    PersistenceConflictClassifier,
    WalletPersistenceConflictClassifier
{
  isWalletIdentityConflict(error: unknown): boolean {
    return (
      error instanceof UniqueConstraintViolationException &&
      (error as ConstraintError).constraint === WALLET_IDENTITY_CONSTRAINT
    );
  }

  isWagerIdempotencyKeyConflict(error: unknown): boolean {
    return (
      error instanceof UniqueConstraintViolationException &&
      (error as ConstraintError).constraint === WAGER_IDEMPOTENCY_CONSTRAINT
    );
  }

  isWagerProviderTransactionConflict(error: unknown): boolean {
    return (
      error instanceof UniqueConstraintViolationException &&
      (error as ConstraintError).constraint ===
        WAGER_PROVIDER_TRANSACTION_CONSTRAINT
    );
  }

  isInboxIdentityConflict(error: unknown): boolean {
    return (
      error instanceof UniqueConstraintViolationException &&
      (error as ConstraintError).constraint === INBOX_IDENTITY_CONSTRAINT
    );
  }

  isLockConflict(error: unknown): boolean {
    return (
      error instanceof DeadlockException ||
      error instanceof LockWaitTimeoutException
    );
  }
}
