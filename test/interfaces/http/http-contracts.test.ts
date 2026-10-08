import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';

import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction.js';
import { resolveCorrelationId } from '../../../src/interfaces/http/correlation-id.js';
import {
  createWalletBodySchema,
  idempotencyKeyHeaderSchema,
  processWagerBodySchema,
  walletLedgerQuerySchema,
} from '../../../src/interfaces/http/http-contracts.js';
import {
  INVALID_HTTP_CONTRACT,
  parseHttpContract,
} from '../../../src/interfaces/http/http-contract-validation.js';

const PLAYER_ID = '10000000-0000-4000-8000-000000000601';
const WALLET_ID = '20000000-0000-4000-8000-000000000601';

const validWager = {
  providerId: 'provider-a',
  externalTransactionId: 'transaction-123',
  playerId: PLAYER_ID,
  walletId: WALLET_ID,
  roundId: 'round-987',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.Bet,
  money: { amount: '25.00', currency: 'BRL' },
} as const;

describe('HTTP contract validation', () => {
  test('accepts wallet money only as an exact decimal string', () => {
    expect(
      parseHttpContract(createWalletBodySchema, {
        playerId: PLAYER_ID,
        initialBalance: { amount: '1000.00', currency: 'BRL' },
      }),
    ).toEqual({
      playerId: PLAYER_ID,
      initialBalance: { amount: '1000.00', currency: 'BRL' },
    });

    for (const amount of [1000, '-1.00', '1', '1.0', '1.000', '1e3']) {
      expect(() =>
        parseHttpContract(createWalletBodySchema, {
          playerId: PLAYER_ID,
          initialBalance: { amount, currency: 'BRL' },
        }),
      ).toThrow(BadRequestException);
    }
  });

  test('rejects invalid UUIDs, currency codes, and unknown wallet fields', () => {
    const invalidBodies = [
      {
        playerId: 'player-1',
        initialBalance: { amount: '1.00', currency: 'BRL' },
      },
      {
        playerId: PLAYER_ID,
        initialBalance: { amount: '1.00', currency: 'brl' },
      },
      {
        playerId: PLAYER_ID,
        initialBalance: { amount: '1.00', currency: 'BRL', cents: 100 },
      },
      {
        playerId: PLAYER_ID,
        initialBalance: { amount: '1.00', currency: 'BRL' },
        version: 1,
      },
    ];

    for (const body of invalidBodies) {
      expect(() => parseHttpContract(createWalletBodySchema, body)).toThrow(
        BadRequestException,
      );
    }
  });

  test('requires positive wager money and forbids external OPENING', () => {
    expect(() =>
      parseHttpContract(processWagerBodySchema, {
        ...validWager,
        money: { amount: '0.00', currency: 'BRL' },
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseHttpContract(processWagerBodySchema, {
        ...validWager,
        kind: WagerTransactionKind.Opening,
      }),
    ).toThrow(BadRequestException);
  });

  test('enforces the reference contract for each wager kind', () => {
    expect(() =>
      parseHttpContract(processWagerBodySchema, {
        ...validWager,
        referenceExternalTransactionId: 'original-bet',
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      parseHttpContract(processWagerBodySchema, {
        ...validWager,
        kind: WagerTransactionKind.Refund,
      }),
    ).toThrow(BadRequestException);

    expect(
      parseHttpContract(processWagerBodySchema, {
        ...validWager,
        kind: WagerTransactionKind.Rollback,
        referenceExternalTransactionId: 'original-bet',
      }),
    ).toMatchObject({
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: 'original-bet',
    });
  });

  test('requires a non-blank idempotency header', () => {
    expect(parseHttpContract(idempotencyKeyHeaderSchema, 'provider-a:tx-1')).toBe(
      'provider-a:tx-1',
    );
    expect(() =>
      parseHttpContract(idempotencyKeyHeaderSchema, undefined),
    ).toThrow(BadRequestException);
    expect(() => parseHttpContract(idempotencyKeyHeaderSchema, '   ')).toThrow(
      BadRequestException,
    );
  });

  test('parses a positive ledger limit without coercing invalid values', () => {
    expect(
      parseHttpContract(walletLedgerQuerySchema, {
        cursor: 'opaque-cursor',
        limit: '50',
      }),
    ).toEqual({ cursor: 'opaque-cursor', limit: 50 });

    for (const limit of ['0', '-1', '1.5', ' 50 ', '9007199254740992']) {
      expect(() =>
        parseHttpContract(walletLedgerQuerySchema, { limit }),
      ).toThrow(BadRequestException);
    }
  });

  test('returns a stable machine-readable error for invalid contracts', () => {
    try {
      parseHttpContract(createWalletBodySchema, {});
      throw new Error('Expected contract validation to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: INVALID_HTTP_CONTRACT,
        message: 'The request does not match the expected HTTP contract.',
      });
    }
  });

  test('preserves a valid correlation ID or generates one when absent', () => {
    expect(resolveCorrelationId('request-123')).toBe('request-123');
    expect(resolveCorrelationId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(() => resolveCorrelationId(' ')).toThrow(BadRequestException);
  });
});
