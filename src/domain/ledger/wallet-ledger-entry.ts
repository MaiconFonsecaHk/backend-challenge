import { Money } from '../shared/value-objects/money.js';
import { LedgerDirection } from './ledger-direction.js';
import {
  InvalidLedgerIdentityError,
  InvalidLedgerTimestampError,
  LedgerCurrencyMismatchError,
  NegativeLedgerBalanceError,
  NonPositiveLedgerAmountError,
  UnbalancedLedgerEntryError,
} from './wallet-ledger-entry.error.js';

export interface CreateLedgerEntryProps {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly createdAt: Date;
}

export type LedgerEntryState = CreateLedgerEntryProps;

export class WalletLedgerEntry {
  private readonly _createdAt: Date;

  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    createdAt: Date,
  ) {
    this._createdAt = WalletLedgerEntry.copyDate(createdAt);
    Object.freeze(this);
  }

  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    WalletLedgerEntry.assertIdentity(props.id, 'id');
    WalletLedgerEntry.assertIdentity(props.walletId, 'walletId');
    WalletLedgerEntry.assertIdentity(props.transactionId, 'transactionId');
    WalletLedgerEntry.assertValidTimestamp(props.createdAt);
    WalletLedgerEntry.assertPositiveAmount(props.money);
    WalletLedgerEntry.assertSameCurrency(props.money, props.balanceBefore, props.balanceAfter);
    WalletLedgerEntry.assertNonNegativeBalances(props.balanceBefore, props.balanceAfter);

    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      props.createdAt,
    );

    if (!entry.isBalanced()) {
      throw new UnbalancedLedgerEntryError();
    }

    return entry;
  }

  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  get createdAt(): Date {
    return WalletLedgerEntry.copyDate(this._createdAt);
  }

  isBalanced(): boolean {
    if (
      !this.money.isPositive() ||
      this.balanceBefore.isNegative() ||
      this.balanceAfter.isNegative() ||
      !this.hasConsistentCurrency()
    ) {
      return false;
    }

    switch (this.direction) {
      case LedgerDirection.Debit:
        return this.balanceBefore.subtract(this.money).equals(this.balanceAfter);
      case LedgerDirection.Credit:
        return this.balanceBefore.add(this.money).equals(this.balanceAfter);
      default:
        return false;
    }
  }

  private static assertIdentity(
    value: string,
    field: 'id' | 'walletId' | 'transactionId',
  ): void {
    if (value.trim().length === 0) {
      throw new InvalidLedgerIdentityError(field);
    }
  }

  private static assertValidTimestamp(value: Date): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidLedgerTimestampError();
    }
  }

  private static assertPositiveAmount(money: Money): void {
    if (!money.isPositive()) {
      throw new NonPositiveLedgerAmountError();
    }
  }

  private static assertSameCurrency(
    money: Money,
    balanceBefore: Money,
    balanceAfter: Money,
  ): void {
    if (
      money.currency !== balanceBefore.currency ||
      money.currency !== balanceAfter.currency
    ) {
      throw new LedgerCurrencyMismatchError();
    }
  }

  private static assertNonNegativeBalances(balanceBefore: Money, balanceAfter: Money): void {
    if (balanceBefore.isNegative() || balanceAfter.isNegative()) {
      throw new NegativeLedgerBalanceError();
    }
  }

  private static copyDate(value: Date): Date {
    return new Date(value.getTime());
  }

  private hasConsistentCurrency(): boolean {
    return (
      this.money.currency === this.balanceBefore.currency &&
      this.money.currency === this.balanceAfter.currency
    );
  }
}
