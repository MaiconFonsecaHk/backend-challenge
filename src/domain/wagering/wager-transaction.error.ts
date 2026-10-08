import { DomainError } from '../shared/errors/domain.error.js';

export class InvalidWagerTransactionIdentityError extends DomainError {
  readonly code = 'INVALID_WAGER_TRANSACTION_IDENTITY';

  constructor(field: string) {
    super(`Wager transaction ${field} must be a non-empty string.`);
  }
}

export class InvalidWagerAmountError extends DomainError {
  readonly code = 'INVALID_WAGER_AMOUNT';

  constructor() {
    super('Wager transaction amounts must be greater than zero.');
  }
}

export class InvalidWagerTimestampError extends DomainError {
  readonly code = 'INVALID_WAGER_TIMESTAMP';

  constructor() {
    super('Wager transaction timestamps must be valid Date values.');
  }
}

export class MissingTransactionReferenceError extends DomainError {
  readonly code = 'MISSING_TRANSACTION_REFERENCE';

  constructor() {
    super('This wager transaction kind requires an external transaction reference.');
  }
}

export class UnexpectedTransactionReferenceError extends DomainError {
  readonly code = 'UNEXPECTED_TRANSACTION_REFERENCE';

  constructor() {
    super('This wager transaction kind cannot carry an external transaction reference.');
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_STATE';

  constructor(currentStatus: string, attemptedTransition: string) {
    super(`Cannot transition wager transaction from ${currentStatus} to ${attemptedTransition}.`);
  }
}

export class InvalidFailureCodeError extends DomainError {
  readonly code = 'INVALID_FAILURE_CODE';

  constructor() {
    super('Failure codes must use stable uppercase machine-readable identifiers.');
  }
}

export class InvalidResolvedReferenceError extends DomainError {
  readonly code = 'INVALID_RESOLVED_REFERENCE';

  constructor() {
    super('The resolved reference must match the presence of the external reference.');
  }
}

export class TransactionDoesNotAffectBalanceError extends DomainError {
  readonly code = 'TRANSACTION_DOES_NOT_AFFECT_BALANCE';

  constructor() {
    super('This wager transaction kind does not produce a ledger entry.');
  }
}

export class InvalidTransactionReferenceError extends DomainError {
  readonly code = 'INVALID_TRANSACTION_REFERENCE';

  constructor(reason: string) {
    super(`Invalid wager transaction reference: ${reason}.`);
  }
}
