import { DomainError } from '../shared/errors/domain.error.js';

export class InvalidLedgerIdentityError extends DomainError {
  readonly code = 'INVALID_LEDGER_IDENTITY';

  constructor(field: 'id' | 'walletId' | 'transactionId') {
    super(`Wallet ledger entry ${field} must be a non-empty string.`);
  }
}

export class InvalidLedgerTimestampError extends DomainError {
  readonly code = 'INVALID_LEDGER_TIMESTAMP';

  constructor() {
    super('Wallet ledger entry timestamps must be valid Date values.');
  }
}

export class NonPositiveLedgerAmountError extends DomainError {
  readonly code = 'NON_POSITIVE_LEDGER_AMOUNT';

  constructor() {
    super('Wallet ledger entry amounts must be greater than zero.');
  }
}

export class LedgerCurrencyMismatchError extends DomainError {
  readonly code = 'LEDGER_CURRENCY_MISMATCH';

  constructor() {
    super('Wallet ledger entry amount and balances must use the same currency.');
  }
}

export class NegativeLedgerBalanceError extends DomainError {
  readonly code = 'NEGATIVE_LEDGER_BALANCE';

  constructor() {
    super('Wallet ledger entry balances cannot be negative.');
  }
}

export class UnbalancedLedgerEntryError extends DomainError {
  readonly code = 'UNBALANCED_LEDGER_ENTRY';

  constructor() {
    super('Wallet ledger entry arithmetic does not reconcile its balances.');
  }
}
