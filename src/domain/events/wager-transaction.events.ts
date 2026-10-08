import type { MoneyProps } from '../shared/value-objects/money.js';
import {
  type FailureCode,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../wagering/wager-transaction.js';
import { IntegrationEvent, type EventContext } from './integration-event.js';
import { InvalidIntegrationEventSourceError } from './integration-event.error.js';

interface WagerTransactionEventData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
}

export interface WagerTransactionProcessedData extends WagerTransactionEventData {
  readonly status: WagerTransactionStatus.Processed;
  readonly referenceTransactionId?: string;
}

export interface WagerTransactionRejectedData extends WagerTransactionEventData {
  readonly status: WagerTransactionStatus.Rejected;
  readonly failureCode: FailureCode;
  readonly referenceExternalTransactionId?: string;
}

export interface WagerTransactionPendingReferenceData extends WagerTransactionEventData {
  readonly status: WagerTransactionStatus.PendingReference;
  readonly referenceExternalTransactionId: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  private constructor(transaction: WagerTransaction, context: EventContext) {
    super({
      ...context,
      aggregateId: transaction.id,
      data: {
        ...transactionData(transaction),
        status: WagerTransactionStatus.Processed,
        ...(transaction.referenceTransactionId === undefined
          ? {}
          : { referenceTransactionId: transaction.referenceTransactionId }),
      },
    });
    Object.freeze(this);
  }

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionProcessed {
    if (
      transaction.status !== WagerTransactionStatus.Processed ||
      transaction.processedAt === undefined
    ) {
      throw new InvalidIntegrationEventSourceError('transaction is not processed');
    }

    return new WagerTransactionProcessed(transaction, context);
  }
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  private constructor(
    transaction: WagerTransaction,
    failureCode: FailureCode,
    context: EventContext,
  ) {
    super({
      ...context,
      aggregateId: transaction.id,
      data: {
        ...transactionData(transaction),
        status: WagerTransactionStatus.Rejected,
        failureCode,
        ...(transaction.referenceExternalTransactionId === undefined
          ? {}
          : { referenceExternalTransactionId: transaction.referenceExternalTransactionId }),
      },
    });
    Object.freeze(this);
  }

  static from(transaction: WagerTransaction, context: EventContext): WagerTransactionRejected {
    if (
      transaction.status !== WagerTransactionStatus.Rejected ||
      transaction.failureCode === undefined ||
      transaction.processedAt === undefined
    ) {
      throw new InvalidIntegrationEventSourceError('transaction is not rejected');
    }

    return new WagerTransactionRejected(transaction, transaction.failureCode, context);
  }
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  private constructor(
    transaction: WagerTransaction,
    referenceExternalTransactionId: string,
    context: EventContext,
  ) {
    super({
      ...context,
      aggregateId: transaction.id,
      data: {
        ...transactionData(transaction),
        status: WagerTransactionStatus.PendingReference,
        referenceExternalTransactionId,
      },
    });
    Object.freeze(this);
  }

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionPendingReference {
    if (
      transaction.status !== WagerTransactionStatus.PendingReference ||
      transaction.referenceExternalTransactionId === undefined
    ) {
      throw new InvalidIntegrationEventSourceError('transaction is not awaiting a reference');
    }

    return new WagerTransactionPendingReference(
      transaction,
      transaction.referenceExternalTransactionId,
      context,
    );
  }
}

function transactionData(transaction: WagerTransaction): WagerTransactionEventData {
  return {
    transactionId: transaction.id,
    providerId: transaction.providerId,
    externalTransactionId: transaction.externalTransactionId,
    walletId: transaction.walletId,
    playerId: transaction.playerId,
    roundId: transaction.roundId,
    gameId: transaction.gameId,
    kind: transaction.kind,
    money: transaction.money.toJSON(),
  };
}
