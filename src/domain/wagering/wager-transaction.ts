import { LedgerDirection } from '../ledger/ledger-direction.js';
import { Money } from '../shared/value-objects/money.js';
import {
  InvalidFailureCodeError,
  InvalidResolvedReferenceError,
  InvalidTransactionReferenceError,
  InvalidTransactionStateError,
  InvalidWagerAmountError,
  InvalidWagerTimestampError,
  InvalidWagerTransactionIdentityError,
  MissingTransactionReferenceError,
  TransactionDoesNotAffectBalanceError,
  UnexpectedTransactionReferenceError,
} from './wager-transaction.error.js';

const FAILURE_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export type FailureCode = string;

interface WagerTransactionIdentity {
  readonly id: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
}

export interface CreateWagerTransactionProps extends WagerTransactionIdentity {
  readonly kind: WagerTransactionKind;
  readonly money: Money;
  readonly referenceExternalTransactionId?: string;
  readonly createdAt: Date;
}

export interface WagerTransactionState extends CreateWagerTransactionProps {
  readonly status: WagerTransactionStatus;
  readonly referenceTransactionId?: string;
  readonly failureCode?: FailureCode;
  readonly processedAt?: Date;
}

export class WagerTransaction {
  private readonly _createdAt: Date;
  private _status: WagerTransactionStatus;
  private _referenceTransactionId?: string;
  private _failureCode?: FailureCode;
  private _processedAt?: Date;

  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    createdAt: Date,
    status: WagerTransactionStatus,
    referenceTransactionId?: string,
    failureCode?: FailureCode,
    processedAt?: Date,
  ) {
    this._createdAt = WagerTransaction.copyDate(createdAt);
    this._status = status;
    this._referenceTransactionId = referenceTransactionId;
    this._failureCode = failureCode;
    this._processedAt = WagerTransaction.copyOptionalDate(processedAt);
  }

  static create(props: CreateWagerTransactionProps): WagerTransaction {
    WagerTransaction.assertIdentity(props);
    WagerTransaction.assertValidTimestamp(props.createdAt);
    WagerTransaction.assertPositiveAmount(props.money);
    WagerTransaction.assertReferenceShape(props.kind, props.referenceExternalTransactionId);

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      WagerTransactionStatus.Pending,
    );
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
    );
  }

  get createdAt(): Date {
    return WagerTransaction.copyDate(this._createdAt);
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return WagerTransaction.copyOptionalDate(this._processedAt);
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertTransitionAllowed(WagerTransactionStatus.Processed);
    WagerTransaction.assertValidTimestamp(at);
    this.assertResolvedReference(referenceTransactionId);

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = WagerTransaction.copyDate(at);
  }

  markPendingReference(): void {
    this.assertTransitionAllowed(WagerTransactionStatus.PendingReference);

    if (this.referenceExternalTransactionId === undefined) {
      throw new MissingTransactionReferenceError();
    }

    this._status = WagerTransactionStatus.PendingReference;
  }

  reject(code: FailureCode, at: Date): void {
    this.assertTransitionAllowed(WagerTransactionStatus.Rejected);
    WagerTransaction.assertFailureCode(code);
    WagerTransaction.assertValidTimestamp(at);

    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = WagerTransaction.copyDate(at);
  }

  fail(code: FailureCode, at: Date): void {
    this.assertTransitionAllowed(WagerTransactionStatus.Failed);
    WagerTransaction.assertFailureCode(code);
    WagerTransaction.assertValidTimestamp(at);

    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = WagerTransaction.copyDate(at);
  }

  isTerminal(): boolean {
    return (
      this.status === WagerTransactionStatus.Processed ||
      this.status === WagerTransactionStatus.Rejected ||
      this.status === WagerTransactionStatus.Failed
    );
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return (
      this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback
    );
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
        this.assertNoReferenceEntity(reference);
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        this.assertNoReferenceEntity(reference);
        return LedgerDirection.Debit;
      case WagerTransactionKind.Win:
        if (this.referenceExternalTransactionId !== undefined) {
          this.assertValidReference(reference, [WagerTransactionKind.Bet], false);
        } else {
          this.assertNoReferenceEntity(reference);
        }
        return LedgerDirection.Credit;
      case WagerTransactionKind.Loss:
        throw new TransactionDoesNotAffectBalanceError();
      case WagerTransactionKind.Refund:
        this.assertValidReference(reference, [WagerTransactionKind.Bet], true);
        return LedgerDirection.Credit;
      case WagerTransactionKind.Rollback:
        this.assertValidReference(
          reference,
          [WagerTransactionKind.Bet, WagerTransactionKind.Win, WagerTransactionKind.Refund],
          true,
        );
        return reference?.kind === WagerTransactionKind.Bet
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;
    }
  }

  private static assertIdentity(identity: WagerTransactionIdentity): void {
    const entries = [
      ['id', identity.id],
      ['providerId', identity.providerId],
      ['externalTransactionId', identity.externalTransactionId],
      ['idempotencyKey', identity.idempotencyKey],
      ['payloadHash', identity.payloadHash],
      ['walletId', identity.walletId],
      ['playerId', identity.playerId],
      ['roundId', identity.roundId],
      ['gameId', identity.gameId],
    ] as const;

    for (const [field, value] of entries) {
      if (value.trim().length === 0) {
        throw new InvalidWagerTransactionIdentityError(field);
      }
    }
  }

  private static assertPositiveAmount(money: Money): void {
    if (!money.isPositive()) {
      throw new InvalidWagerAmountError();
    }
  }

  private static assertReferenceShape(
    kind: WagerTransactionKind,
    referenceExternalTransactionId: string | undefined,
  ): void {
    if (
      (kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback) &&
      (referenceExternalTransactionId === undefined ||
        referenceExternalTransactionId.trim().length === 0)
    ) {
      throw new MissingTransactionReferenceError();
    }

    if (
      (kind === WagerTransactionKind.Opening ||
        kind === WagerTransactionKind.Bet ||
        kind === WagerTransactionKind.Loss) &&
      referenceExternalTransactionId !== undefined
    ) {
      throw new UnexpectedTransactionReferenceError();
    }

    if (referenceExternalTransactionId !== undefined && referenceExternalTransactionId.trim().length === 0) {
      throw new MissingTransactionReferenceError();
    }
  }

  private static assertValidTimestamp(value: Date): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidWagerTimestampError();
    }
  }

  private static assertFailureCode(code: FailureCode): void {
    if (!FAILURE_CODE_PATTERN.test(code)) {
      throw new InvalidFailureCodeError();
    }
  }

  private static copyDate(value: Date): Date {
    return new Date(value.getTime());
  }

  private static copyOptionalDate(value: Date | undefined): Date | undefined {
    return value === undefined ? undefined : WagerTransaction.copyDate(value);
  }

  private assertTransitionAllowed(nextStatus: WagerTransactionStatus): void {
    const isPendingTransition =
      this.status === WagerTransactionStatus.Pending ||
      (this.status === WagerTransactionStatus.PendingReference &&
        nextStatus !== WagerTransactionStatus.PendingReference);

    if (!isPendingTransition) {
      throw new InvalidTransactionStateError(this.status, nextStatus);
    }
  }

  private assertResolvedReference(referenceTransactionId: string | undefined): void {
    const hasExternalReference = this.referenceExternalTransactionId !== undefined;
    const hasResolvedReference =
      referenceTransactionId !== undefined && referenceTransactionId.trim().length > 0;

    if (hasExternalReference !== hasResolvedReference) {
      throw new InvalidResolvedReferenceError();
    }
  }

  private assertNoReferenceEntity(reference: WagerTransaction | undefined): void {
    if (reference !== undefined) {
      throw new InvalidTransactionReferenceError('an unexpected reference entity was supplied');
    }
  }

  private assertValidReference(
    reference: WagerTransaction | undefined,
    allowedKinds: readonly WagerTransactionKind[],
    requiresEqualAmount: boolean,
  ): asserts reference is WagerTransaction {
    if (reference === undefined) {
      throw new InvalidTransactionReferenceError('the referenced transaction was not supplied');
    }

    if (reference.externalTransactionId !== this.referenceExternalTransactionId) {
      throw new InvalidTransactionReferenceError('the external transaction id does not match');
    }

    if (!reference.isTerminal() || reference.status !== WagerTransactionStatus.Processed) {
      throw new InvalidTransactionReferenceError('the referenced transaction is not processed');
    }

    if (!allowedKinds.includes(reference.kind)) {
      throw new InvalidTransactionReferenceError('the referenced transaction kind is not allowed');
    }

    const hasMatchingContext =
      reference.providerId === this.providerId &&
      reference.playerId === this.playerId &&
      reference.walletId === this.walletId &&
      reference.roundId === this.roundId &&
      reference.money.currency === this.money.currency;

    if (!hasMatchingContext) {
      throw new InvalidTransactionReferenceError('the referenced transaction context does not match');
    }

    if (requiresEqualAmount && !reference.money.equals(this.money)) {
      throw new InvalidTransactionReferenceError('the referenced transaction amount does not match');
    }
  }
}
