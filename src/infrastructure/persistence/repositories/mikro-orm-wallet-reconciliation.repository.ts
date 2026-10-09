import type { EntityManager } from '@mikro-orm/postgresql';

import type {
  WalletReconciliationRepository,
  WalletReconciliationSnapshot,
} from '../../../application/ports/persistence/repositories.js';
import { moneyFromPersistence } from '../mappers/money.persistence-mapper.js';

interface WalletReconciliationRow {
  readonly walletId: string;
  readonly storedBalance: string;
  readonly currency: string;
  readonly calculatedBalance: string;
  readonly checkedEntries: string;
}

export class MikroOrmWalletReconciliationRepository
  implements WalletReconciliationRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  async findByWalletId(
    walletId: string,
  ): Promise<WalletReconciliationSnapshot | undefined> {
    const rows = await this.entityManager.execute<WalletReconciliationRow[]>(
      `select
         wallet.id as "walletId",
         wallet.balance::text as "storedBalance",
         wallet.currency as currency,
         coalesce(
           sum(
             case ledger.direction
               when 'CREDIT' then ledger.amount
               when 'DEBIT' then -ledger.amount
             end
           ),
           0
         )::text as "calculatedBalance",
         count(ledger.id)::text as "checkedEntries"
       from wallets wallet
       left join wallet_ledger_entries ledger on ledger.wallet_id = wallet.id
       where wallet.id = ?
       group by wallet.id, wallet.balance, wallet.currency`,
      [walletId],
      'all',
    );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    const checkedEntries = Number(row.checkedEntries);
    if (
      !Number.isSafeInteger(checkedEntries) ||
      checkedEntries < 0 ||
      checkedEntries.toString() !== row.checkedEntries
    ) {
      throw new Error('PostgreSQL returned an invalid ledger entry count');
    }

    return Object.freeze({
      storedBalance: moneyFromPersistence(row.storedBalance, row.currency),
      calculatedBalance: moneyFromPersistence(
        row.calculatedBalance,
        row.currency,
      ),
      checkedEntries,
    });
  }
}
