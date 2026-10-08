import type { MoneyProps } from '../../domain/shared/value-objects/money.js';
import type {
  PersistenceRepositories,
  WagerTransactionRecord,
} from './persistence/repositories.js';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../domain/wagering/wager-transaction.js';

export const WAGER_TRANSACTION_PROCESSOR = Symbol(
  'WAGER_TRANSACTION_PROCESSOR',
);

export type ExternalWagerTransactionKind = Exclude<
  WagerTransactionKind,
  WagerTransactionKind.Opening
>;

export interface NormalizedWagerTransactionCommand {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: ExternalWagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
  readonly correlationId: string;
}

export interface WagerTransactionProcessingCommand
  extends NormalizedWagerTransactionCommand {
  readonly payloadHash: string;
}

export interface ProcessWagerTransactionResult {
  readonly transactionId: string;
  readonly status: WagerTransactionStatus;
  readonly balance?: MoneyProps;
  readonly failureCode?: string;
  readonly idempotentReplay: boolean;
}

export interface WagerTransactionProcessor {
  process(
    command: WagerTransactionProcessingCommand,
  ): Promise<ProcessWagerTransactionResult>;
}

export interface NewWagerTransactionExecutor {
  execute(
    command: WagerTransactionProcessingCommand,
    repositories: PersistenceRepositories,
  ): Promise<WagerTransactionRecord>;
}
