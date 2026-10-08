import { MikroORM } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import type { PersistenceRepositories } from '../../application/ports/persistence/repositories.js';
import type {
  UnitOfWork,
  UnitOfWorkCallback,
} from '../../application/ports/persistence/unit-of-work.js';
import { MikroOrmInboxMessageRepository } from './repositories/mikro-orm-inbox-message.repository.js';
import { MikroOrmOutboxMessageRepository } from './repositories/mikro-orm-outbox-message.repository.js';
import { MikroOrmWagerTransactionRepository } from './repositories/mikro-orm-wager-transaction.repository.js';
import { MikroOrmWalletLedgerEntryRepository } from './repositories/mikro-orm-wallet-ledger-entry.repository.js';
import { MikroOrmWalletReconciliationRepository } from './repositories/mikro-orm-wallet-reconciliation.repository.js';
import { MikroOrmWalletRepository } from './repositories/mikro-orm-wallet.repository.js';

@Injectable()
export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly orm: MikroORM) {}

  execute<T>(work: UnitOfWorkCallback<T>): Promise<T> {
    return this.orm.em.transactional(async (entityManager) => {
      const repositories: PersistenceRepositories = Object.freeze({
        wallets: new MikroOrmWalletRepository(entityManager),
        walletReconciliations: new MikroOrmWalletReconciliationRepository(
          entityManager,
        ),
        wagerTransactions: new MikroOrmWagerTransactionRepository(
          entityManager,
        ),
        walletLedgerEntries: new MikroOrmWalletLedgerEntryRepository(
          entityManager,
        ),
        inboxMessages: new MikroOrmInboxMessageRepository(entityManager),
        outboxMessages: new MikroOrmOutboxMessageRepository(entityManager),
      });

      return work(repositories);
    });
  }
}
