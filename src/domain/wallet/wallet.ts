import { CurrencyMismatchError } from '../shared/errors/money.error.js';
import { Money } from '../shared/value-objects/money.js';
import { LedgerDirection } from '../ledger/ledger-direction.js';
import {
  InsufficientFundsError,
  InvalidWalletIdentityError,
  InvalidWalletTimestampError,
  NegativeInitialBalanceError,
  NonPositiveWalletMovementError,
} from './wallet.error.js';

export interface OpenWalletProps {
  readonly id: string;
  readonly playerId: string;
  readonly initialBalance: Money;
  readonly openedAt: Date;
}

export interface WalletState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: Money;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface WalletBalanceChange {
  readonly direction: LedgerDirection;
  readonly money: Money;
  readonly balanceBefore: Money;
  readonly balanceAfter: Money;
  readonly walletVersion: number;
}

export class Wallet {
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    this._createdAt = Wallet.copyDate(createdAt);
    this._updatedAt = Wallet.copyDate(updatedAt);
  }

  static open(props: OpenWalletProps): Wallet {
    Wallet.assertIdentity(props.id, 'id');
    Wallet.assertIdentity(props.playerId, 'playerId');
    Wallet.assertValidTimestamp(props.openedAt);

    if (props.initialBalance.isNegative()) {
      throw new NegativeInitialBalanceError();
    }

    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      props.openedAt,
      props.openedAt,
    );
  }

  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return Wallet.copyDate(this._createdAt);
  }

  get updatedAt(): Date {
    return Wallet.copyDate(this._updatedAt);
  }

  debit(money: Money, at: Date): WalletBalanceChange {
    this.assertMovement(money, at);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.subtract(money);

    if (balanceAfter.isNegative()) {
      throw new InsufficientFundsError();
    }

    return this.applyBalanceChange(
      LedgerDirection.Debit,
      money,
      balanceBefore,
      balanceAfter,
      at,
    );
  }

  credit(money: Money, at: Date): WalletBalanceChange {
    this.assertMovement(money, at);

    const balanceBefore = this._balance;
    const balanceAfter = balanceBefore.add(money);

    return this.applyBalanceChange(
      LedgerDirection.Credit,
      money,
      balanceBefore,
      balanceAfter,
      at,
    );
  }

  private static assertIdentity(value: string, field: 'id' | 'playerId'): void {
    if (value.trim().length === 0) {
      throw new InvalidWalletIdentityError(field);
    }
  }

  private static assertValidTimestamp(value: Date): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidWalletTimestampError();
    }
  }

  private static copyDate(value: Date): Date {
    return new Date(value.getTime());
  }

  private assertMovement(money: Money, at: Date): void {
    this.assertSameCurrency(money);
    Wallet.assertValidTimestamp(at);

    if (!money.isPositive()) {
      throw new NonPositiveWalletMovementError();
    }
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }

  private applyBalanceChange(
    direction: LedgerDirection,
    money: Money,
    balanceBefore: Money,
    balanceAfter: Money,
    at: Date,
  ): WalletBalanceChange {
    this._balance = balanceAfter;
    this._version += 1;
    this._updatedAt = Wallet.copyDate(at);

    return Object.freeze({
      direction,
      money,
      balanceBefore,
      balanceAfter,
      walletVersion: this._version,
    });
  }
}
