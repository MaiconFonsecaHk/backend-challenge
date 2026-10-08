import { WagerTransactionNotFoundError } from '../../errors/wager-application.error.js';
import type { WagerTransactionRecord } from '../../ports/persistence/repositories.js';
import type { UnitOfWork } from '../../ports/persistence/unit-of-work.js';
import type { MoneyProps } from '../../../domain/shared/value-objects/money.js';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../domain/wagering/wager-transaction.js';

export interface GetProviderWagerTransactionQuery {
  readonly providerId: string;
  readonly externalTransactionId: string;
}

export interface WagerTransactionQueryResult {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly status: WagerTransactionStatus;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
  readonly referenceTransactionId?: string;
  readonly failureCode?: string;
  readonly balance?: MoneyProps;
  readonly createdAt: string;
  readonly processedAt?: string;
}

export class GetWagerTransactionByIdUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(transactionId: string): Promise<WagerTransactionQueryResult> {
    return this.unitOfWork.execute(async (repositories) => {
      const record = await repositories.wagerTransactions.findById(
        transactionId,
      );

      return requireTransaction(record);
    });
  }
}

export class GetProviderWagerTransactionUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(
    query: GetProviderWagerTransactionQuery,
  ): Promise<WagerTransactionQueryResult> {
    return this.unitOfWork.execute(async (repositories) => {
      const record =
        await repositories.wagerTransactions.findByProviderTransaction(
          query.providerId,
          query.externalTransactionId,
        );

      return requireTransaction(record);
    });
  }
}

function requireTransaction(
  record: WagerTransactionRecord | undefined,
): WagerTransactionQueryResult {
  if (record === undefined) {
    throw new WagerTransactionNotFoundError();
  }

  const { transaction } = record;

  return Object.freeze({
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    status: transaction.status,
    money: Object.freeze(transaction.money.toJSON()),
    ...(transaction.referenceExternalTransactionId === undefined
      ? {}
      : {
          referenceExternalTransactionId:
            transaction.referenceExternalTransactionId,
        }),
    ...(transaction.referenceTransactionId === undefined
      ? {}
      : { referenceTransactionId: transaction.referenceTransactionId }),
    ...(transaction.failureCode === undefined
      ? {}
      : { failureCode: transaction.failureCode }),
    ...(record.resultBalance === undefined
      ? {}
      : { balance: Object.freeze(record.resultBalance.toJSON()) }),
    createdAt: transaction.createdAt.toISOString(),
    ...(transaction.processedAt === undefined
      ? {}
      : { processedAt: transaction.processedAt.toISOString() }),
  });
}
