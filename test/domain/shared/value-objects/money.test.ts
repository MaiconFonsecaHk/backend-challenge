import { describe, expect, test } from 'bun:test';

import {
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidMoneyAmountError,
} from '../../../../src/domain/shared/errors/money.error.js';
import { Money } from '../../../../src/domain/shared/value-objects/money.js';

describe('Money', () => {
  test('creates an immutable value and serializes it with a fixed scale', () => {
    const money = Money.from({ amount: '25.00', currency: 'BRL' });

    expect(Object.isFrozen(money)).toBe(true);
    expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    expect(money.toString()).toBe('25.00 BRL');
  });

  test('canonicalizes leading zeros and negative zero during serialization', () => {
    expect(Money.from({ amount: '00025.00', currency: 'BRL' }).toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });
    expect(Money.from({ amount: '-0.00', currency: 'BRL' }).toJSON()).toEqual({
      amount: '0.00',
      currency: 'BRL',
    });
  });

  test('creates zero in the requested currency', () => {
    const zero = Money.zero('USD');

    expect(zero.toJSON()).toEqual({ amount: '0.00', currency: 'USD' });
    expect(zero.isZero()).toBe(true);
    expect(zero.isPositive()).toBe(false);
    expect(zero.isNegative()).toBe(false);
  });

  test('adds values exactly without mutating either operand', () => {
    const left = Money.from({ amount: '10.10', currency: 'BRL' });
    const right = Money.from({ amount: '2.20', currency: 'BRL' });

    const result = left.add(right);

    expect(result.toJSON()).toEqual({ amount: '12.30', currency: 'BRL' });
    expect(left.toJSON()).toEqual({ amount: '10.10', currency: 'BRL' });
    expect(right.toJSON()).toEqual({ amount: '2.20', currency: 'BRL' });
    expect(result).not.toBe(left);
  });

  test('preserves exact arithmetic for values beyond JavaScript safe integers', () => {
    const left = Money.from({
      amount: '999999999999999999999999999999.99',
      currency: 'BRL',
    });
    const right = Money.from({ amount: '0.01', currency: 'BRL' });

    expect(left.add(right).toJSON()).toEqual({
      amount: '1000000000000000000000000000000.00',
      currency: 'BRL',
    });
  });

  test('subtracts values exactly and may produce a negative domain value', () => {
    const result = Money.from({ amount: '5.00', currency: 'BRL' }).subtract(
      Money.from({ amount: '7.25', currency: 'BRL' }),
    );

    expect(result.toJSON()).toEqual({ amount: '-2.25', currency: 'BRL' });
    expect(result.isNegative()).toBe(true);
  });

  test('negates values without mutating the original value', () => {
    const positive = Money.from({ amount: '3.40', currency: 'BRL' });
    const negative = positive.negate();

    expect(negative.toJSON()).toEqual({ amount: '-3.40', currency: 'BRL' });
    expect(negative.negate().equals(positive)).toBe(true);
    expect(positive.toJSON()).toEqual({ amount: '3.40', currency: 'BRL' });
  });

  test('supports signed values needed by domain calculations', () => {
    const negative = Money.from({ amount: '-1.00', currency: 'BRL' });

    expect(negative.isNegative()).toBe(true);
    expect(negative.isPositive()).toBe(false);
    expect(negative.isZero()).toBe(false);
  });

  test('compares values with the same currency', () => {
    const smaller = Money.from({ amount: '1.00', currency: 'BRL' });
    const equal = Money.from({ amount: '1.00', currency: 'BRL' });
    const larger = Money.from({ amount: '2.00', currency: 'BRL' });

    expect(smaller.isLessThan(larger)).toBe(true);
    expect(larger.isLessThan(smaller)).toBe(false);
    expect(smaller.equals(equal)).toBe(true);
    expect(smaller.equals(larger)).toBe(false);
  });

  test.each([
    '',
    ' ',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e2',
    '1E+2',
    '1',
    '1.0',
    '1.000',
    '+1.00',
    '.50',
    '1.',
    '1,00',
  ])('rejects an invalid amount representation: %s', (amount) => {
    expect(() => Money.from({ amount, currency: 'BRL' })).toThrow(InvalidMoneyAmountError);
  });

  test.each(['', 'BR', 'BRLL', 'brl', '12A', ' BRL', 'BRL '])(
    'rejects an invalid currency representation: %s',
    (currency) => {
      expect(() => Money.from({ amount: '1.00', currency })).toThrow(InvalidCurrencyError);
    },
  );

  test('rejects every binary operation between different currencies', () => {
    const brl = Money.from({ amount: '1.00', currency: 'BRL' });
    const usd = Money.from({ amount: '1.00', currency: 'USD' });

    expect(() => brl.add(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.subtract(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.isLessThan(usd)).toThrow(CurrencyMismatchError);
    expect(() => brl.equals(usd)).toThrow(CurrencyMismatchError);
  });

  test('exposes stable error codes for invalid values and currency conflicts', () => {
    expect(new InvalidMoneyAmountError().code).toBe('INVALID_MONEY_AMOUNT');
    expect(new InvalidCurrencyError().code).toBe('INVALID_CURRENCY');
    expect(new CurrencyMismatchError('BRL', 'USD').code).toBe('CURRENCY_MISMATCH');
  });
});
