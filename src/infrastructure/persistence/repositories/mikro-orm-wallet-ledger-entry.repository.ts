import { QueryOrder, type EntityManager } from '@mikro-orm/postgresql';

import type {
  WalletLedgerEntryRepository,
  WalletLedgerPageQuery,
} from '../../../application/ports/persistence/repositories.js';
import type { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.js';
import { WalletLedgerEntryPersistenceEntity } from '../entities/wallet-ledger-entry.persistence-entity.js';
import { WalletLedgerEntryPersistenceMapper } from '../mappers/wallet-ledger-entry.persistence-mapper.js';

export class MikroOrmWalletLedgerEntryRepository
  implements WalletLedgerEntryRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  async findByWalletAndTransaction(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | undefined> {
    const entity = await this.entityManager.findOne(
      WalletLedgerEntryPersistenceEntity,
      { walletId, transactionId },
    );

    return entity === null
      ? undefined
      : WalletLedgerEntryPersistenceMapper.toDomain(entity);
  }

  async listByWallet(
    walletId: string,
    query: WalletLedgerPageQuery,
  ): Promise<readonly WalletLedgerEntry[]> {
    const entities = await this.entityManager.find(
      WalletLedgerEntryPersistenceEntity,
      {
        walletId,
        ...(query.before === undefined
          ? {}
          : {
              $or: [
                { createdAt: { $lt: query.before.createdAt } },
                {
                  createdAt: query.before.createdAt,
                  id: { $lt: query.before.id },
                },
              ],
            }),
      },
      {
        limit: query.limit,
        orderBy: {
          createdAt: QueryOrder.DESC,
          id: QueryOrder.DESC,
        },
      },
    );

    return entities.map(WalletLedgerEntryPersistenceMapper.toDomain);
  }

  async add(entry: WalletLedgerEntry): Promise<void> {
    const entity = this.entityManager.create(
      WalletLedgerEntryPersistenceEntity,
      WalletLedgerEntryPersistenceMapper.toPersistence(entry),
    );

    this.entityManager.persist(entity);
  }
}
