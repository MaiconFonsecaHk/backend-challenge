import { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.js';
import type { LedgerDirection } from '../../../domain/ledger/ledger-direction.js';
import type { WalletLedgerEntryPersistenceEntity } from '../entities/wallet-ledger-entry.persistence-entity.js';
import {
  moneyFromPersistence,
  moneyToPersistence,
} from './money.persistence-mapper.js';

export interface WalletLedgerEntryPersistenceState {
  readonly id: string;
  readonly walletId: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly amount: string;
  readonly balanceBefore: string;
  readonly balanceAfter: string;
  readonly currency: string;
  readonly createdAt: Date;
}

export class WalletLedgerEntryPersistenceMapper {
  static toDomain(
    entity: WalletLedgerEntryPersistenceEntity,
  ): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction,
      money: moneyFromPersistence(entity.amount, entity.currency),
      balanceBefore: moneyFromPersistence(
        entity.balanceBefore,
        entity.currency,
      ),
      balanceAfter: moneyFromPersistence(entity.balanceAfter, entity.currency),
      createdAt: entity.createdAt,
    });
  }

  static toPersistence(
    entry: WalletLedgerEntry,
  ): WalletLedgerEntryPersistenceState {
    const money = moneyToPersistence(entry.money);

    return {
      id: entry.id,
      walletId: entry.walletId,
      transactionId: entry.transactionId,
      direction: entry.direction,
      amount: money.amount,
      balanceBefore: entry.balanceBefore.toJSON().amount,
      balanceAfter: entry.balanceAfter.toJSON().amount,
      currency: money.currency,
      createdAt: entry.createdAt,
    };
  }
}
