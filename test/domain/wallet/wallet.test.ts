import { describe, expect, test } from 'bun:test';

import { CurrencyMismatchError } from '../../../src/domain/shared/errors/money.error.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  InsufficientFundsError,
  InvalidWalletIdentityError,
  InvalidWalletTimestampError,
  NegativeInitialBalanceError,
  NonPositiveWalletMovementError,
} from '../../../src/domain/wallet/wallet.error.js';
import { Wallet, WalletBalanceChangeDirection } from '../../../src/domain/wallet/wallet.js';

const OPENED_AT = new Date('2026-10-07T12:00:00.000Z');
const MOVED_AT = new Date('2026-10-07T12:05:00.000Z');

function brl(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function openWallet(initialBalance = '100.00'): Wallet {
  return Wallet.open({
    id: 'wallet-1',
    playerId: 'player-1',
    initialBalance: brl(initialBalance),
    openedAt: OPENED_AT,
  });
}

describe('Wallet', () => {
  test('opens with the supplied identity, currency, balance, timestamps, and version one', () => {
    const wallet = openWallet();

    expect(wallet.id).toBe('wallet-1');
    expect(wallet.playerId).toBe('player-1');
    expect(wallet.currency).toBe('BRL');
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
    expect(wallet.createdAt).toEqual(OPENED_AT);
    expect(wallet.updatedAt).toEqual(OPENED_AT);
  });

  test('allows a wallet to open with a zero balance', () => {
    const wallet = openWallet('0.00');

    expect(wallet.balance.isZero()).toBe(true);
    expect(wallet.version).toBe(1);
  });

  test('rejects a negative initial balance', () => {
    expect(() => openWallet('-0.01')).toThrow(NegativeInitialBalanceError);
  });

  test.each([
    { id: '', playerId: 'player-1' },
    { id: '   ', playerId: 'player-1' },
    { id: 'wallet-1', playerId: '' },
    { id: 'wallet-1', playerId: '   ' },
  ])('rejects an empty wallet identity: %o', ({ id, playerId }) => {
    expect(() =>
      Wallet.open({ id, playerId, initialBalance: brl('0.00'), openedAt: OPENED_AT }),
    ).toThrow(InvalidWalletIdentityError);
  });

  test('protects internal timestamps from external Date mutation', () => {
    const openedAt = new Date(OPENED_AT);
    const wallet = Wallet.open({
      id: 'wallet-1',
      playerId: 'player-1',
      initialBalance: brl('0.00'),
      openedAt,
    });

    openedAt.setUTCFullYear(2030);
    wallet.createdAt.setUTCFullYear(2031);
    wallet.updatedAt.setUTCFullYear(2032);

    expect(wallet.createdAt).toEqual(OPENED_AT);
    expect(wallet.updatedAt).toEqual(OPENED_AT);
  });

  test('credits the balance and returns an immutable description of the change', () => {
    const wallet = openWallet();
    const money = brl('25.50');
    const movedAt = new Date(MOVED_AT.getTime());

    const change = wallet.credit(money, movedAt);
    movedAt.setUTCFullYear(2030);

    expect(change).toEqual({
      direction: WalletBalanceChangeDirection.Credit,
      money,
      balanceBefore: brl('100.00'),
      balanceAfter: brl('125.50'),
      walletVersion: 2,
    });
    expect(Object.isFrozen(change)).toBe(true);
    expect(wallet.balance.toJSON()).toEqual({ amount: '125.50', currency: 'BRL' });
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(MOVED_AT);
    expect(wallet.createdAt).toEqual(OPENED_AT);
  });

  test('debits the balance down to exactly zero', () => {
    const wallet = openWallet();
    const money = brl('100.00');

    const change = wallet.debit(money, MOVED_AT);

    expect(change.direction).toBe(WalletBalanceChangeDirection.Debit);
    expect(change.money).toBe(money);
    expect(change.balanceBefore.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(change.balanceAfter.toJSON()).toEqual({ amount: '0.00', currency: 'BRL' });
    expect(change.walletVersion).toBe(2);
    expect(wallet.balance.isZero()).toBe(true);
    expect(wallet.version).toBe(2);
  });

  test('rejects an overdraft without changing wallet state', () => {
    const wallet = openWallet();

    expect(() => wallet.debit(brl('100.01'), MOVED_AT)).toThrow(InsufficientFundsError);
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
    expect(wallet.updatedAt).toEqual(OPENED_AT);
  });

  test.each(['0.00', '-0.01'])(
    'rejects a non-positive credit without changing wallet state: %s',
    (amount) => {
      const wallet = openWallet();

      expect(() => wallet.credit(brl(amount), MOVED_AT)).toThrow(NonPositiveWalletMovementError);
      expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(OPENED_AT);
    },
  );

  test.each(['0.00', '-0.01'])(
    'rejects a non-positive debit without changing wallet state: %s',
    (amount) => {
      const wallet = openWallet();

      expect(() => wallet.debit(brl(amount), MOVED_AT)).toThrow(NonPositiveWalletMovementError);
      expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(OPENED_AT);
    },
  );

  test('rejects credit and debit in another currency without changing wallet state', () => {
    const wallet = openWallet();
    const usd = Money.from({ amount: '1.00', currency: 'USD' });

    expect(() => wallet.credit(usd, MOVED_AT)).toThrow(CurrencyMismatchError);
    expect(() => wallet.debit(usd, MOVED_AT)).toThrow(CurrencyMismatchError);
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  test('increments the version once for each successful balance change', () => {
    const wallet = openWallet();

    wallet.credit(brl('20.00'), new Date('2026-10-07T12:01:00.000Z'));
    wallet.debit(brl('5.00'), new Date('2026-10-07T12:02:00.000Z'));

    expect(wallet.balance.toJSON()).toEqual({ amount: '115.00', currency: 'BRL' });
    expect(wallet.version).toBe(3);
    expect(wallet.updatedAt).toEqual(new Date('2026-10-07T12:02:00.000Z'));
  });

  test('rejects invalid timestamps without changing wallet state', () => {
    expect(() =>
      Wallet.open({
        id: 'wallet-1',
        playerId: 'player-1',
        initialBalance: brl('0.00'),
        openedAt: new Date('invalid'),
      }),
    ).toThrow(InvalidWalletTimestampError);

    const wallet = openWallet();
    expect(() => wallet.credit(brl('1.00'), new Date('invalid'))).toThrow(
      InvalidWalletTimestampError,
    );
    expect(wallet.balance.toJSON()).toEqual({ amount: '100.00', currency: 'BRL' });
    expect(wallet.version).toBe(1);
  });

  test('rehydrates persisted state without replaying creation or balance transitions', () => {
    const createdAt = new Date('2026-10-01T10:00:00.000Z');
    const updatedAt = new Date('2026-10-02T11:00:00.000Z');
    const wallet = Wallet.rehydrate({
      id: 'wallet-9',
      playerId: 'player-7',
      currency: 'USD',
      balance: Money.from({ amount: '42.75', currency: 'USD' }),
      version: 8,
      createdAt,
      updatedAt,
    });

    createdAt.setUTCFullYear(2030);
    updatedAt.setUTCFullYear(2030);

    expect(wallet.id).toBe('wallet-9');
    expect(wallet.playerId).toBe('player-7');
    expect(wallet.currency).toBe('USD');
    expect(wallet.balance.toJSON()).toEqual({ amount: '42.75', currency: 'USD' });
    expect(wallet.version).toBe(8);
    expect(wallet.createdAt).toEqual(new Date('2026-10-01T10:00:00.000Z'));
    expect(wallet.updatedAt).toEqual(new Date('2026-10-02T11:00:00.000Z'));
  });

  test('exposes stable error codes for wallet invariant violations', () => {
    expect(new InvalidWalletIdentityError('id').code).toBe('INVALID_WALLET_IDENTITY');
    expect(new NegativeInitialBalanceError().code).toBe('NEGATIVE_INITIAL_BALANCE');
    expect(new NonPositiveWalletMovementError().code).toBe('NON_POSITIVE_WALLET_MOVEMENT');
    expect(new InsufficientFundsError().code).toBe('INSUFFICIENT_FUNDS');
    expect(new InvalidWalletTimestampError().code).toBe('INVALID_WALLET_TIMESTAMP');
  });
});
