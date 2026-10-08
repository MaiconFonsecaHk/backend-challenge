import type { EntityManager } from '@mikro-orm/postgresql';

import type { WalletRepository } from '../../../application/ports/persistence/repositories.js';
import type { Wallet } from '../../../domain/wallet/wallet.js';
import { WalletPersistenceEntity } from '../entities/wallet.persistence-entity.js';
import { WalletPersistenceMapper } from '../mappers/wallet.persistence-mapper.js';
import { PersistenceRecordNotFoundError } from './persistence-record-not-found.error.js';

export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string): Promise<Wallet | undefined> {
    const entity = await this.entityManager.findOne(
      WalletPersistenceEntity,
      { id },
    );

    return entity === null
      ? undefined
      : WalletPersistenceMapper.toDomain(entity);
  }

  async findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined> {
    const entity = await this.entityManager.findOne(
      WalletPersistenceEntity,
      { playerId, currency },
    );

    return entity === null
      ? undefined
      : WalletPersistenceMapper.toDomain(entity);
  }

  async add(wallet: Wallet): Promise<void> {
    const entity = this.entityManager.create(
      WalletPersistenceEntity,
      WalletPersistenceMapper.toPersistence(wallet),
    );

    this.entityManager.persist(entity);
  }

  async save(wallet: Wallet): Promise<void> {
    const entity = await this.entityManager.findOne(
      WalletPersistenceEntity,
      { id: wallet.id },
    );

    if (entity === null) {
      throw new PersistenceRecordNotFoundError('wallet', wallet.id);
    }

    const state = WalletPersistenceMapper.toPersistence(wallet);
    this.entityManager.assign(entity, {
      balance: state.balance,
      version: state.version,
      updatedAt: state.updatedAt,
    });
  }
}
