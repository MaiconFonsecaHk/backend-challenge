import { Money } from '../../../domain/shared/value-objects/money.js';

const PERSISTED_DECIMAL_PATTERN = /^-?\d+(?:\.\d{1,2})?$/u;

export interface PersistedMoney {
  readonly amount: string;
  readonly currency: string;
}

export function moneyFromPersistence(
  amount: string,
  currency: string,
): Money {
  if (!PERSISTED_DECIMAL_PATTERN.test(amount)) {
    return Money.from({ amount, currency });
  }

  const [integerPart, fractionPart = ''] = amount.split('.');

  return Money.from({
    amount: `${integerPart}.${fractionPart.padEnd(2, '0')}`,
    currency,
  });
}

export function moneyToPersistence(money: Money): PersistedMoney {
  return money.toJSON();
}
