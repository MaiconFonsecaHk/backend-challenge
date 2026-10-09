import { Wallet } from '../../../domain/wallet/wallet.js';
import type { WalletPersistenceEntity } from '../entities/wallet.persistence-entity.js';
import {
  moneyFromPersistence,
  moneyToPersistence,
} from './money.persistence-mapper.js';

export interface WalletPersistenceState {
  readonly id: string;
  readonly playerId: string;
  readonly currency: string;
  readonly balance: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class WalletPersistenceMapper {
  static toDomain(entity: WalletPersistenceEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: moneyFromPersistence(entity.balance, entity.currency),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  static toPersistence(wallet: Wallet): WalletPersistenceState {
    const balance = moneyToPersistence(wallet.balance);

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: balance.currency,
      balance: balance.amount,
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    };
  }
}
