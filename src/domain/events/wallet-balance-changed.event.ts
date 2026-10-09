import { LedgerDirection } from '../ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../ledger/wallet-ledger-entry.js';
import type { MoneyProps } from '../shared/value-objects/money.js';
import { Wallet } from '../wallet/wallet.js';
import { IntegrationEvent, type EventContext } from './integration-event.js';
import { InvalidIntegrationEventSourceError } from './integration-event.error.js';

export interface WalletBalanceChangedData {
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly walletVersion: number;
}

export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  private constructor(wallet: Wallet, entry: WalletLedgerEntry, context: EventContext) {
    super({
      ...context,
      aggregateId: wallet.id,
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
    Object.freeze(this);
  }

  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    context: EventContext,
  ): WalletBalanceChanged {
    if (entry.walletId !== wallet.id) {
      throw new InvalidIntegrationEventSourceError('ledger entry belongs to another wallet');
    }

    if (!entry.isBalanced()) {
      throw new InvalidIntegrationEventSourceError('ledger entry is not balanced');
    }

    if (
      wallet.balance.currency !== entry.balanceAfter.currency ||
      !wallet.balance.equals(entry.balanceAfter)
    ) {
      throw new InvalidIntegrationEventSourceError('wallet balance does not match the ledger entry');
    }

    return new WalletBalanceChanged(wallet, entry, context);
  }
}
