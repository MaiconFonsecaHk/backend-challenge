import { describe, expect, test } from 'bun:test';

import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
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
} from '../../../src/domain/wagering/wager-transaction.error.js';
import {
  type CreateWagerTransactionProps,
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';

const CREATED_AT = new Date('2026-10-07T13:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-07T13:05:00.000Z');

function money(amount = '10.00', currency = 'BRL'): Money {
  return Money.from({ amount, currency });
}

function createTransaction(
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return WagerTransaction.create({
    id: 'transaction-id',
    providerId: 'provider-a',
    externalTransactionId: 'transaction-external',
    idempotencyKey: 'provider-a:transaction-external',
    payloadHash: 'payload-hash',
    walletId: 'wallet-id',
    playerId: 'player-id',
    roundId: 'round-id',
    gameId: 'game-id',
    kind: WagerTransactionKind.Bet,
    money: money(),
    createdAt: CREATED_AT,
    ...overrides,
  });
}

function createProcessedReference(
  kind: WagerTransactionKind.Bet | WagerTransactionKind.Win | WagerTransactionKind.Refund,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  const referenceExternalTransactionId =
    kind === WagerTransactionKind.Refund ? 'original-bet-external' : undefined;
  const transaction = createTransaction({
    id: 'reference-id',
    externalTransactionId: 'reference-external',
    idempotencyKey: 'provider-a:reference-external',
    payloadHash: 'reference-payload-hash',
    kind,
    referenceExternalTransactionId,
    ...overrides,
  });

  transaction.markProcessed(referenceExternalTransactionId === undefined ? undefined : 'original-bet-id', PROCESSED_AT);

  return transaction;
}

function createReferencingTransaction(
  kind: WagerTransactionKind.Win | WagerTransactionKind.Refund | WagerTransactionKind.Rollback,
  overrides: Partial<CreateWagerTransactionProps> = {},
): WagerTransaction {
  return createTransaction({
    kind,
    referenceExternalTransactionId: 'reference-external',
    ...overrides,
  });
}

describe('WagerTransaction', () => {
  test.each([
    WagerTransactionKind.Opening,
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Loss,
    WagerTransactionKind.Refund,
    WagerTransactionKind.Rollback,
  ])('creates %s transactions in the pending state', (kind) => {
    const referenceExternalTransactionId =
      kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
        ? 'reference-external'
        : undefined;
    const transaction = createTransaction({ kind, referenceExternalTransactionId });

    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
    expect(transaction.kind).toBe(kind);
    expect(transaction.referenceExternalTransactionId).toBe(referenceExternalTransactionId);
    expect(transaction.referenceTransactionId).toBeUndefined();
    expect(transaction.failureCode).toBeUndefined();
    expect(transaction.processedAt).toBeUndefined();
    expect(transaction.isTerminal()).toBe(false);
  });

  test('preserves every transaction identity and financial field', () => {
    const transaction = createTransaction();

    expect(transaction).toMatchObject({
      id: 'transaction-id',
      providerId: 'provider-a',
      externalTransactionId: 'transaction-external',
      idempotencyKey: 'provider-a:transaction-external',
      payloadHash: 'payload-hash',
      walletId: 'wallet-id',
      playerId: 'player-id',
      roundId: 'round-id',
      gameId: 'game-id',
      kind: WagerTransactionKind.Bet,
      money: money(),
    });
    expect(transaction.createdAt).toEqual(CREATED_AT);
  });

  test('rejects an empty value in every required identity field', () => {
    const fields: ReadonlyArray<keyof CreateWagerTransactionProps> = [
      'id',
      'providerId',
      'externalTransactionId',
      'idempotencyKey',
      'payloadHash',
      'walletId',
      'playerId',
      'roundId',
      'gameId',
    ];

    for (const field of fields) {
      expect(() => createTransaction({ [field]: '   ' })).toThrow(
        InvalidWagerTransactionIdentityError,
      );
    }
  });

  test.each(['0.00', '-0.01'])(
    'rejects a wager amount that is not positive: %s',
    (amount) => {
      expect(() => createTransaction({ money: money(amount) })).toThrow(InvalidWagerAmountError);
    },
  );

  test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
    'requires an external reference for %s',
    (kind) => {
      expect(() => createTransaction({ kind })).toThrow(MissingTransactionReferenceError);
      expect(() => createTransaction({ kind, referenceExternalTransactionId: '   ' })).toThrow(
        MissingTransactionReferenceError,
      );
    },
  );

  test.each([
    WagerTransactionKind.Opening,
    WagerTransactionKind.Bet,
    WagerTransactionKind.Loss,
  ])('rejects an external reference for %s', (kind) => {
    expect(() => createTransaction({ kind, referenceExternalTransactionId: 'reference-external' })).toThrow(
      UnexpectedTransactionReferenceError,
    );
  });

  test('allows WIN to omit or carry an external BET reference', () => {
    expect(createTransaction({ kind: WagerTransactionKind.Win }).referenceExternalTransactionId).toBeUndefined();
    expect(
      createReferencingTransaction(WagerTransactionKind.Win).referenceExternalTransactionId,
    ).toBe('reference-external');
  });

  test('protects creation and processing timestamps from external mutation', () => {
    const createdAt = new Date(CREATED_AT.getTime());
    const processedAt = new Date(PROCESSED_AT.getTime());
    const transaction = createTransaction({ createdAt });

    transaction.markProcessed(undefined, processedAt);
    createdAt.setUTCFullYear(2030);
    processedAt.setUTCFullYear(2030);
    transaction.createdAt.setUTCFullYear(2031);
    transaction.processedAt?.setUTCFullYear(2031);

    expect(transaction.createdAt).toEqual(CREATED_AT);
    expect(transaction.processedAt).toEqual(PROCESSED_AT);
  });

  test('rejects invalid creation and terminal timestamps without changing state', () => {
    expect(() => createTransaction({ createdAt: new Date('invalid') })).toThrow(
      InvalidWagerTimestampError,
    );

    const transaction = createTransaction();
    expect(() => transaction.markProcessed(undefined, new Date('invalid'))).toThrow(
      InvalidWagerTimestampError,
    );
    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
  });

  test('moves a referenced transaction through pending reference to processed', () => {
    const transaction = createReferencingTransaction(WagerTransactionKind.Refund);

    transaction.markPendingReference();
    expect(transaction.status).toBe(WagerTransactionStatus.PendingReference);
    expect(transaction.isTerminal()).toBe(false);

    transaction.markProcessed('reference-id', PROCESSED_AT);
    expect(transaction.status).toBe(WagerTransactionStatus.Processed);
    expect(transaction.referenceTransactionId).toBe('reference-id');
    expect(transaction.processedAt).toEqual(PROCESSED_AT);
    expect(transaction.isTerminal()).toBe(true);
  });

  test('only allows pending-reference state when an external reference exists', () => {
    const transaction = createTransaction();

    expect(() => transaction.markPendingReference()).toThrow(MissingTransactionReferenceError);
    expect(transaction.status).toBe(WagerTransactionStatus.Pending);
  });

  test('rejects a repeated pending-reference transition', () => {
    const transaction = createReferencingTransaction(WagerTransactionKind.Rollback);
    transaction.markPendingReference();

    expect(() => transaction.markPendingReference()).toThrow(InvalidTransactionStateError);
  });

  test('requires the resolved reference to match the external reference shape', () => {
    const referenced = createReferencingTransaction(WagerTransactionKind.Refund);
    const independent = createTransaction();

    expect(() => referenced.markProcessed(undefined, PROCESSED_AT)).toThrow(
      InvalidResolvedReferenceError,
    );
    expect(() => referenced.markProcessed('   ', PROCESSED_AT)).toThrow(
      InvalidResolvedReferenceError,
    );
    expect(() => independent.markProcessed('reference-id', PROCESSED_AT)).toThrow(
      InvalidResolvedReferenceError,
    );
    expect(referenced.status).toBe(WagerTransactionStatus.Pending);
    expect(independent.status).toBe(WagerTransactionStatus.Pending);
  });

  test.each([
    ['rejects', WagerTransactionStatus.Rejected, 'INSUFFICIENT_FUNDS'],
    ['fails', WagerTransactionStatus.Failed, 'PERSISTENCE_FAILURE'],
  ] as const)('%s with a stable failure code and completion timestamp', (_, status, code) => {
    const transaction = createTransaction();

    if (status === WagerTransactionStatus.Rejected) {
      transaction.reject(code, PROCESSED_AT);
    } else {
      transaction.fail(code, PROCESSED_AT);
    }

    expect(transaction.status).toBe(status);
    expect(transaction.failureCode).toBe(code);
    expect(transaction.processedAt).toEqual(PROCESSED_AT);
    expect(transaction.isTerminal()).toBe(true);
  });

  test.each(['', 'lowercase', 'INVALID CODE', '_INVALID', 'INVALID_', 'INVALID__CODE'])(
    'rejects an unstable failure code without changing state: %s',
    (code) => {
      const transaction = createTransaction();

      expect(() => transaction.reject(code, PROCESSED_AT)).toThrow(InvalidFailureCodeError);
      expect(transaction.status).toBe(WagerTransactionStatus.Pending);
      expect(transaction.failureCode).toBeUndefined();
    },
  );

  test.each([
    WagerTransactionStatus.Processed,
    WagerTransactionStatus.Rejected,
    WagerTransactionStatus.Failed,
  ])('blocks every transition after reaching terminal state %s', (terminalStatus) => {
    const transaction = createTransaction();

    if (terminalStatus === WagerTransactionStatus.Processed) {
      transaction.markProcessed(undefined, PROCESSED_AT);
    } else if (terminalStatus === WagerTransactionStatus.Rejected) {
      transaction.reject('BUSINESS_REJECTION', PROCESSED_AT);
    } else {
      transaction.fail('PERMANENT_FAILURE', PROCESSED_AT);
    }

    expect(() => transaction.markProcessed(undefined, PROCESSED_AT)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.markPendingReference()).toThrow(InvalidTransactionStateError);
    expect(() => transaction.reject('ANOTHER_REJECTION', PROCESSED_AT)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.fail('ANOTHER_FAILURE', PROCESSED_AT)).toThrow(
      InvalidTransactionStateError,
    );
  });

  test.each([
    [WagerTransactionKind.Opening, true],
    [WagerTransactionKind.Bet, true],
    [WagerTransactionKind.Win, true],
    [WagerTransactionKind.Loss, false],
    [WagerTransactionKind.Refund, true],
    [WagerTransactionKind.Rollback, true],
  ] as const)('reports whether %s affects the balance', (kind, expected) => {
    const referenceExternalTransactionId =
      kind === WagerTransactionKind.Refund || kind === WagerTransactionKind.Rollback
        ? 'reference-external'
        : undefined;

    expect(createTransaction({ kind, referenceExternalTransactionId }).affectsBalance()).toBe(expected);
  });

  test.each([
    [WagerTransactionKind.Opening, false],
    [WagerTransactionKind.Bet, false],
    [WagerTransactionKind.Win, false],
    [WagerTransactionKind.Loss, false],
    [WagerTransactionKind.Refund, true],
    [WagerTransactionKind.Rollback, true],
  ] as const)('reports whether %s requires a reference', (kind, expected) => {
    const referenceExternalTransactionId = expected ? 'reference-external' : undefined;

    expect(createTransaction({ kind, referenceExternalTransactionId }).requiresReference()).toBe(expected);
  });

  test('compares payload hashes without using transport metadata', () => {
    const transaction = createTransaction();

    expect(transaction.matchesPayload('payload-hash')).toBe(true);
    expect(transaction.matchesPayload('different-hash')).toBe(false);
  });

  test.each([
    [WagerTransactionKind.Opening, LedgerDirection.Credit],
    [WagerTransactionKind.Bet, LedgerDirection.Debit],
    [WagerTransactionKind.Win, LedgerDirection.Credit],
  ] as const)('returns the ledger direction for %s', (kind, direction) => {
    expect(createTransaction({ kind }).ledgerDirectionFor()).toBe(direction);
  });

  test('does not assign a ledger direction to LOSS', () => {
    const transaction = createTransaction({ kind: WagerTransactionKind.Loss });

    expect(() => transaction.ledgerDirectionFor()).toThrow(TransactionDoesNotAffectBalanceError);
  });

  test('validates an optional WIN reference without requiring equal amounts', () => {
    const reference = createProcessedReference(WagerTransactionKind.Bet);
    const transaction = createReferencingTransaction(WagerTransactionKind.Win, {
      money: money('25.00'),
    });

    expect(transaction.ledgerDirectionFor(reference)).toBe(LedgerDirection.Credit);
  });

  test('validates a REFUND reference and returns credit direction', () => {
    const reference = createProcessedReference(WagerTransactionKind.Bet);
    const transaction = createReferencingTransaction(WagerTransactionKind.Refund);

    expect(transaction.ledgerDirectionFor(reference)).toBe(LedgerDirection.Credit);
  });

  test.each([
    [WagerTransactionKind.Bet, LedgerDirection.Credit],
    [WagerTransactionKind.Win, LedgerDirection.Debit],
    [WagerTransactionKind.Refund, LedgerDirection.Debit],
  ] as const)('returns the inverse direction when rolling back %s', (kind, direction) => {
    const reference = createProcessedReference(kind);
    const transaction = createReferencingTransaction(WagerTransactionKind.Rollback);

    expect(transaction.ledgerDirectionFor(reference)).toBe(direction);
  });

  test('rejects a missing or unexpected reference entity when calculating direction', () => {
    const refund = createReferencingTransaction(WagerTransactionKind.Refund);
    const bet = createTransaction();
    const reference = createProcessedReference(WagerTransactionKind.Bet);

    expect(() => refund.ledgerDirectionFor()).toThrow(InvalidTransactionReferenceError);
    expect(() => bet.ledgerDirectionFor(reference)).toThrow(InvalidTransactionReferenceError);
  });

  test('requires the reference external id, processed status, and allowed kind', () => {
    const transaction = createReferencingTransaction(WagerTransactionKind.Refund);
    const wrongExternalId = createProcessedReference(WagerTransactionKind.Bet, {
      externalTransactionId: 'another-reference',
    });
    const pendingReference = createTransaction({
      id: 'reference-id',
      externalTransactionId: 'reference-external',
      idempotencyKey: 'provider-a:reference-external',
    });
    const wrongKind = createProcessedReference(WagerTransactionKind.Win);

    expect(() => transaction.ledgerDirectionFor(wrongExternalId)).toThrow(
      InvalidTransactionReferenceError,
    );
    expect(() => transaction.ledgerDirectionFor(pendingReference)).toThrow(
      InvalidTransactionReferenceError,
    );
    expect(() => transaction.ledgerDirectionFor(wrongKind)).toThrow(
      InvalidTransactionReferenceError,
    );
  });

  test.each([
    { providerId: 'provider-b' },
    { playerId: 'another-player' },
    { walletId: 'another-wallet' },
    { roundId: 'another-round' },
    { money: money('10.00', 'USD') },
  ])('rejects a reference from a different required context: %o', (overrides) => {
    const reference = createProcessedReference(WagerTransactionKind.Bet, overrides);
    const transaction = createReferencingTransaction(WagerTransactionKind.Refund);

    expect(() => transaction.ledgerDirectionFor(reference)).toThrow(
      InvalidTransactionReferenceError,
    );
  });

  test.each([WagerTransactionKind.Refund, WagerTransactionKind.Rollback])(
    'requires %s amount to equal the referenced amount',
    (kind) => {
      const reference = createProcessedReference(WagerTransactionKind.Bet, {
        money: money('11.00'),
      });
      const transaction = createReferencingTransaction(kind);

      expect(() => transaction.ledgerDirectionFor(reference)).toThrow(
        InvalidTransactionReferenceError,
      );
    },
  );

  test('rehydrates persisted state without replaying transition validation', () => {
    const createdAt = new Date(CREATED_AT.getTime());
    const processedAt = new Date(PROCESSED_AT.getTime());
    const transaction = WagerTransaction.rehydrate({
      id: 'transaction-id',
      providerId: 'provider-a',
      externalTransactionId: 'transaction-external',
      idempotencyKey: 'provider-a:transaction-external',
      payloadHash: 'payload-hash',
      walletId: 'wallet-id',
      playerId: 'player-id',
      roundId: 'round-id',
      gameId: 'game-id',
      kind: WagerTransactionKind.Refund,
      money: money(),
      referenceExternalTransactionId: 'reference-external',
      createdAt,
      status: WagerTransactionStatus.Rejected,
      failureCode: 'REFERENCE_NOT_FOUND',
      processedAt,
    });

    createdAt.setUTCFullYear(2030);
    processedAt.setUTCFullYear(2030);

    expect(transaction.status).toBe(WagerTransactionStatus.Rejected);
    expect(transaction.failureCode).toBe('REFERENCE_NOT_FOUND');
    expect(transaction.createdAt).toEqual(CREATED_AT);
    expect(transaction.processedAt).toEqual(PROCESSED_AT);
    expect(transaction.isTerminal()).toBe(true);
  });

  test('exposes stable error codes for transaction invariant violations', () => {
    expect(new InvalidWagerTransactionIdentityError('id').code).toBe(
      'INVALID_WAGER_TRANSACTION_IDENTITY',
    );
    expect(new InvalidWagerAmountError().code).toBe('INVALID_WAGER_AMOUNT');
    expect(new InvalidWagerTimestampError().code).toBe('INVALID_WAGER_TIMESTAMP');
    expect(new MissingTransactionReferenceError().code).toBe('MISSING_TRANSACTION_REFERENCE');
    expect(new UnexpectedTransactionReferenceError().code).toBe(
      'UNEXPECTED_TRANSACTION_REFERENCE',
    );
    expect(new InvalidTransactionStateError('PENDING', 'PENDING').code).toBe(
      'INVALID_TRANSACTION_STATE',
    );
    expect(new InvalidFailureCodeError().code).toBe('INVALID_FAILURE_CODE');
    expect(new InvalidResolvedReferenceError().code).toBe('INVALID_RESOLVED_REFERENCE');
    expect(new TransactionDoesNotAffectBalanceError().code).toBe(
      'TRANSACTION_DOES_NOT_AFFECT_BALANCE',
    );
    expect(new InvalidTransactionReferenceError('reason').code).toBe(
      'INVALID_TRANSACTION_REFERENCE',
    );
  });
});
