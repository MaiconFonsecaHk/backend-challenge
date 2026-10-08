import {
  InvalidLedgerPageLimitError,
  WalletNotFoundError,
} from '../../errors/wallet-application.error.js';
import type { LedgerCursorCodec } from '../../ports/ledger-cursor-codec.js';
import type { UnitOfWork } from '../../ports/persistence/unit-of-work.js';
import type { LedgerDirection } from '../../../domain/ledger/ledger-direction.js';
import type { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.js';
import type { MoneyProps } from '../../../domain/shared/value-objects/money.js';

const DEFAULT_LEDGER_PAGE_LIMIT = 50;

export interface GetWalletLedgerQuery {
  readonly walletId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface WalletLedgerItemResult {
  readonly id: string;
  readonly transactionId: string;
  readonly direction: LedgerDirection;
  readonly money: MoneyProps;
  readonly balanceBefore: MoneyProps;
  readonly balanceAfter: MoneyProps;
  readonly createdAt: string;
}

export interface GetWalletLedgerResult {
  readonly items: readonly WalletLedgerItemResult[];
  readonly nextCursor?: string;
}

export class GetWalletLedgerUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly cursorCodec: LedgerCursorCodec,
  ) {}

  execute(query: GetWalletLedgerQuery): Promise<GetWalletLedgerResult> {
    const limit = query.limit ?? DEFAULT_LEDGER_PAGE_LIMIT;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new InvalidLedgerPageLimitError();
    }

    const before =
      query.cursor === undefined
        ? undefined
        : this.cursorCodec.decode(query.cursor);

    return this.unitOfWork.execute(async (repositories) => {
      if ((await repositories.wallets.findById(query.walletId)) === undefined) {
        throw new WalletNotFoundError(query.walletId);
      }

      const entries = await repositories.walletLedgerEntries.listByWallet(
        query.walletId,
        { before, limit: limit + 1 },
      );
      const hasNextPage = entries.length > limit;
      const pageEntries = hasNextPage ? entries.slice(0, limit) : entries;
      const lastEntry = pageEntries.at(-1);
      const nextCursor =
        hasNextPage && lastEntry !== undefined
          ? this.cursorCodec.encode({
              createdAt: lastEntry.createdAt,
              id: lastEntry.id,
            })
          : undefined;

      return Object.freeze({
        items: Object.freeze(pageEntries.map(GetWalletLedgerUseCase.toResult)),
        ...(nextCursor === undefined ? {} : { nextCursor }),
      });
    });
  }

  private static toResult(entry: WalletLedgerEntry): WalletLedgerItemResult {
    return Object.freeze({
      id: entry.id,
      transactionId: entry.transactionId,
      direction: entry.direction,
      money: Object.freeze(entry.money.toJSON()),
      balanceBefore: Object.freeze(entry.balanceBefore.toJSON()),
      balanceAfter: Object.freeze(entry.balanceAfter.toJSON()),
      createdAt: entry.createdAt.toISOString(),
    });
  }
}
