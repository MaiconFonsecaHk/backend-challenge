import { describe, expect, test } from 'bun:test';

import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import {
  InvalidLedgerIdentityError,
  InvalidLedgerTimestampError,
  LedgerCurrencyMismatchError,
  NegativeLedgerBalanceError,
  NonPositiveLedgerAmountError,
  UnbalancedLedgerEntryError,
} from '../../../src/domain/ledger/wallet-ledger-entry.error.js';
import {
  type CreateLedgerEntryProps,
  WalletLedgerEntry,
} from '../../../src/domain/ledger/wallet-ledger-entry.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';

const CREATED_AT = new Date('2026-10-07T14:00:00.000Z');

function money(amount: string, currency = 'BRL'): Money {
  return Money.from({ amount, currency });
}

function createEntry(overrides: Partial<CreateLedgerEntryProps> = {}): WalletLedgerEntry {
  return WalletLedgerEntry.create({
    id: 'ledger-entry-id',
    walletId: 'wallet-id',
    transactionId: 'transaction-id',
    direction: LedgerDirection.Debit,
    money: money('25.00'),
    balanceBefore: money('100.00'),
    balanceAfter: money('75.00'),
    createdAt: CREATED_AT,
    ...overrides,
  });
}

describe('WalletLedgerEntry', () => {
  test('creates a structurally immutable debit entry with balanced arithmetic', () => {
    const entry = createEntry();

    expect(entry).toMatchObject({
      id: 'ledger-entry-id',
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Debit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
    });
    expect(entry.createdAt).toEqual(CREATED_AT);
    expect(entry.isBalanced()).toBe(true);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  test('creates a balanced credit entry', () => {
    const entry = createEntry({
      direction: LedgerDirection.Credit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('125.00'),
    });

    expect(entry.direction).toBe(LedgerDirection.Credit);
    expect(entry.isBalanced()).toBe(true);
  });

  test('allows a debit to reduce the balance to exactly zero', () => {
    const entry = createEntry({
      money: money('100.00'),
      balanceAfter: money('0.00'),
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.balanceAfter.isZero()).toBe(true);
  });

  test('preserves exact ledger arithmetic beyond JavaScript safe integers', () => {
    const entry = createEntry({
      direction: LedgerDirection.Credit,
      money: money('0.01'),
      balanceBefore: money('999999999999999999999999999999.99'),
      balanceAfter: money('1000000000000000000000000000000.00'),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  test('protects its timestamp from external Date mutation', () => {
    const createdAt = new Date(CREATED_AT.getTime());
    const entry = createEntry({ createdAt });

    createdAt.setUTCFullYear(2030);
    entry.createdAt.setUTCFullYear(2031);

    expect(entry.createdAt).toEqual(CREATED_AT);
  });

  test.each([
    { id: '', walletId: 'wallet-id', transactionId: 'transaction-id' },
    { id: 'ledger-entry-id', walletId: '   ', transactionId: 'transaction-id' },
    { id: 'ledger-entry-id', walletId: 'wallet-id', transactionId: '' },
  ])('rejects an empty required identity: %o', (identity) => {
    expect(() => createEntry(identity)).toThrow(InvalidLedgerIdentityError);
  });

  test('rejects an invalid timestamp', () => {
    expect(() => createEntry({ createdAt: new Date('invalid') })).toThrow(
      InvalidLedgerTimestampError,
    );
  });

  test.each(['0.00', '-0.01'])(
    'rejects a ledger amount that is not positive: %s',
    (amount) => {
      expect(() => createEntry({ money: money(amount) })).toThrow(NonPositiveLedgerAmountError);
    },
  );

  test.each([
    {
      money: money('25.00', 'USD'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00'),
    },
    {
      money: money('25.00'),
      balanceBefore: money('100.00', 'USD'),
      balanceAfter: money('75.00'),
    },
    {
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('75.00', 'USD'),
    },
  ])('rejects inconsistent currencies: %o', (values) => {
    expect(() => createEntry(values)).toThrow(LedgerCurrencyMismatchError);
  });

  test.each([
    { balanceBefore: money('-1.00'), balanceAfter: money('0.00') },
    { balanceBefore: money('1.00'), balanceAfter: money('-1.00') },
  ])('rejects a negative ledger balance: %o', (balances) => {
    expect(() => createEntry(balances)).toThrow(NegativeLedgerBalanceError);
  });

  test.each([
    {
      direction: LedgerDirection.Debit,
      balanceBefore: money('100.00'),
      balanceAfter: money('76.00'),
    },
    {
      direction: LedgerDirection.Credit,
      balanceBefore: money('100.00'),
      balanceAfter: money('124.00'),
    },
  ])('rejects arithmetic that does not reconcile: %o', (values) => {
    expect(() => createEntry(values)).toThrow(UnbalancedLedgerEntryError);
  });

  test('rehydrates a persisted entry without hiding inconsistent arithmetic', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'ledger-entry-id',
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Debit,
      money: money('25.00'),
      balanceBefore: money('100.00'),
      balanceAfter: money('80.00'),
      createdAt: CREATED_AT,
    });

    expect(entry.isBalanced()).toBe(false);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  test('reports false for rehydrated data with inconsistent currencies or negative balances', () => {
    const currencyMismatch = WalletLedgerEntry.rehydrate({
      id: 'currency-mismatch',
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Credit,
      money: money('1.00', 'USD'),
      balanceBefore: money('10.00'),
      balanceAfter: money('11.00'),
      createdAt: CREATED_AT,
    });
    const negativeBalance = WalletLedgerEntry.rehydrate({
      id: 'negative-balance',
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: LedgerDirection.Debit,
      money: money('1.00'),
      balanceBefore: money('0.00'),
      balanceAfter: money('-1.00'),
      createdAt: CREATED_AT,
    });

    expect(currencyMismatch.isBalanced()).toBe(false);
    expect(negativeBalance.isBalanced()).toBe(false);
  });

  test('reports false for a rehydrated entry with an unknown ledger direction', () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: 'invalid-direction',
      walletId: 'wallet-id',
      transactionId: 'transaction-id',
      direction: 'UNKNOWN' as LedgerDirection,
      money: money('1.00'),
      balanceBefore: money('10.00'),
      balanceAfter: money('11.00'),
      createdAt: CREATED_AT,
    });

    expect(entry.isBalanced()).toBe(false);
  });

  test('exposes stable error codes for ledger invariant violations', () => {
    expect(new InvalidLedgerIdentityError('id').code).toBe('INVALID_LEDGER_IDENTITY');
    expect(new InvalidLedgerTimestampError().code).toBe('INVALID_LEDGER_TIMESTAMP');
    expect(new NonPositiveLedgerAmountError().code).toBe('NON_POSITIVE_LEDGER_AMOUNT');
    expect(new LedgerCurrencyMismatchError().code).toBe('LEDGER_CURRENCY_MISMATCH');
    expect(new NegativeLedgerBalanceError().code).toBe('NEGATIVE_LEDGER_BALANCE');
    expect(new UnbalancedLedgerEntryError().code).toBe('UNBALANCED_LEDGER_ENTRY');
  });
});
