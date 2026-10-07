import { DomainError } from './domain.error.js';

export class InvalidMoneyAmountError extends DomainError {
  readonly code = 'INVALID_MONEY_AMOUNT';

  constructor() {
    super('Money amount must be a signed decimal string with exactly two decimal places.');
  }
}

export class InvalidCurrencyError extends DomainError {
  readonly code = 'INVALID_CURRENCY';

  constructor() {
    super('Money currency must use the uppercase ISO-4217 alpha-3 format.');
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(leftCurrency: string, rightCurrency: string) {
    super(`Cannot operate on money with different currencies: ${leftCurrency} and ${rightCurrency}.`);
  }
}
