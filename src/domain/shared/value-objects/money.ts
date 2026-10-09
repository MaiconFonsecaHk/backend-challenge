import Big from 'big.js';

import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from '../errors/money.error.js';

const DECIMAL_WITH_FIXED_SCALE_PATTERN = /^-?\d+\.\d{2}$/u;
const ISO_4217_ALPHA_CODE_PATTERN = /^[A-Z]{3}$/u;
const ZERO = '0';

export interface MoneyProps {
  readonly amount: string;
  readonly currency: string;
}

export class Money {
  private constructor(
    private readonly value: Big,
    public readonly currency: string,
  ) {
    Object.freeze(this);
  }

  static from(props: MoneyProps): Money {
    if (!DECIMAL_WITH_FIXED_SCALE_PATTERN.test(props.amount)) {
      throw new InvalidMoneyAmountError();
    }

    Money.assertCurrency(props.currency);

    return new Money(new Big(props.amount), props.currency);
  }

  static zero(currency: string): Money {
    Money.assertCurrency(currency);

    return new Money(new Big(ZERO), currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);

    return Money.fromValue(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);

    return Money.fromValue(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return Money.fromValue(this.value.neg(), this.currency);
  }

  isZero(): boolean {
    return this.value.eq(ZERO);
  }

  isPositive(): boolean {
    return this.value.gt(ZERO);
  }

  isNegative(): boolean {
    return this.value.lt(ZERO);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.value.lt(other.value);
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other);

    return this.value.eq(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    const { amount, currency } = this.toJSON();

    return `${amount} ${currency}`;
  }

  private static assertCurrency(currency: string): void {
    if (!ISO_4217_ALPHA_CODE_PATTERN.test(currency)) {
      throw new InvalidCurrencyError();
    }
  }

  private static fromValue(value: Big, currency: string): Money {
    return new Money(value, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
