import { DomainError } from '../shared/errors/domain.error.js';

export class InvalidWalletIdentityError extends DomainError {
  readonly code = 'INVALID_WALLET_IDENTITY';

  constructor(field: 'id' | 'playerId') {
    super(`Wallet ${field} must be a non-empty string.`);
  }
}

export class NegativeInitialBalanceError extends DomainError {
  readonly code = 'NEGATIVE_INITIAL_BALANCE';

  constructor() {
    super('A wallet cannot be opened with a negative balance.');
  }
}

export class NonPositiveWalletMovementError extends DomainError {
  readonly code = 'NON_POSITIVE_WALLET_MOVEMENT';

  constructor() {
    super('Wallet credit and debit amounts must be greater than zero.');
  }
}

export class InsufficientFundsError extends DomainError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor() {
    super('The wallet does not have sufficient funds for this debit.');
  }
}

export class InvalidWalletTimestampError extends DomainError {
  readonly code = 'INVALID_WALLET_TIMESTAMP';

  constructor() {
    super('Wallet timestamps must be valid Date values.');
  }
}
