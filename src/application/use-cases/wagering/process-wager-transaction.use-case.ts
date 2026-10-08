import {
  ExternalOpeningNotAllowedError,
  InvalidWagerCommandError,
} from '../../errors/wager-application.error.js';
import type {
  ExternalWagerTransactionKind,
  NormalizedWagerTransactionCommand,
  ProcessWagerTransactionResult,
  WagerTransactionProcessor,
} from '../../ports/wager-transaction-processor.js';
import {
  Money,
  type MoneyProps,
} from '../../../domain/shared/value-objects/money.js';
import { WagerTransactionKind } from '../../../domain/wagering/wager-transaction.js';

export interface ProcessWagerTransactionCommand {
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly playerId: string;
  readonly walletId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly referenceExternalTransactionId?: string;
  readonly correlationId: string;
}

const EXTERNAL_KINDS = new Set<WagerTransactionKind>([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

export class ProcessWagerTransactionUseCase {
  constructor(private readonly processor: WagerTransactionProcessor) {}

  async execute(
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    const normalized = ProcessWagerTransactionUseCase.normalize(command);
    const result = await this.processor.process(normalized);

    return Object.freeze({
      transactionId: result.transactionId,
      status: result.status,
      ...(result.balance === undefined
        ? {}
        : { balance: Object.freeze({ ...result.balance }) }),
      ...(result.failureCode === undefined
        ? {}
        : { failureCode: result.failureCode }),
      idempotentReplay: result.idempotentReplay,
    });
  }

  private static normalize(
    command: ProcessWagerTransactionCommand,
  ): NormalizedWagerTransactionCommand {
    if (command.kind === WagerTransactionKind.Opening) {
      throw new ExternalOpeningNotAllowedError();
    }
    if (!EXTERNAL_KINDS.has(command.kind)) {
      throw new InvalidWagerCommandError('kind is unsupported');
    }

    const identities = [
      ['providerId', command.providerId],
      ['externalTransactionId', command.externalTransactionId],
      ['idempotencyKey', command.idempotencyKey],
      ['playerId', command.playerId],
      ['walletId', command.walletId],
      ['roundId', command.roundId],
      ['gameId', command.gameId],
      ['correlationId', command.correlationId],
    ] as const;
    for (const [field, value] of identities) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new InvalidWagerCommandError(`${field} must be non-empty`);
      }
    }

    ProcessWagerTransactionUseCase.assertReferenceShape(command);
    const domainMoney = Money.from(command.money);
    if (!domainMoney.isPositive()) {
      throw new InvalidWagerCommandError('money amount must be positive');
    }
    const money = Object.freeze(domainMoney.toJSON());

    return Object.freeze({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind as ExternalWagerTransactionKind,
      money,
      ...(command.referenceExternalTransactionId === undefined
        ? {}
        : {
            referenceExternalTransactionId:
              command.referenceExternalTransactionId,
          }),
      correlationId: command.correlationId,
    });
  }

  private static assertReferenceShape(
    command: ProcessWagerTransactionCommand,
  ): void {
    const reference = command.referenceExternalTransactionId;
    const requiresReference =
      command.kind === WagerTransactionKind.Refund ||
      command.kind === WagerTransactionKind.Rollback;
    const forbidsReference =
      command.kind === WagerTransactionKind.Bet ||
      command.kind === WagerTransactionKind.Loss;

    if (
      requiresReference &&
      (typeof reference !== 'string' || reference.trim().length === 0)
    ) {
      throw new InvalidWagerCommandError(
        `${command.kind} requires referenceExternalTransactionId`,
      );
    }
    if (forbidsReference && reference !== undefined) {
      throw new InvalidWagerCommandError(
        `${command.kind} cannot carry referenceExternalTransactionId`,
      );
    }
    if (
      reference !== undefined &&
      (typeof reference !== 'string' || reference.trim().length === 0)
    ) {
      throw new InvalidWagerCommandError(
        'referenceExternalTransactionId must be non-empty when supplied',
      );
    }
  }
}
