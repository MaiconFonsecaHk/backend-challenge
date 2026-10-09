import { describe, expect, mock, test } from 'bun:test';

import type { Clock } from '../../../src/application/ports/clock.js';
import type {
  OperationalLogContext,
  OperationalLogger,
} from '../../../src/application/ports/operational-logger.js';
import type { PayloadDigest } from '../../../src/application/ports/payload-digest.js';
import type { ProcessWagerTransactionUseCase } from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction.js';
import {
  InvalidSqsMessageGroupError,
  InvalidSqsWagerMessageError,
} from '../../../src/interfaces/messaging/sqs-wager-message.error.js';
import { SqsWagerMessageHandler } from '../../../src/interfaces/messaging/sqs-wager-message.handler.js';

const RECEIVED_AT = new Date('2026-10-08T21:00:00.000Z');
const PLAYER_ID = '10000000-0000-4000-8000-000000000701';
const WALLET_ID = '20000000-0000-4000-8000-000000000701';

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    messageId: 'message-701',
    type: 'WagerTransactionRequested',
    occurredAt: '2026-10-08T20:59:59.000Z',
    data: {
      providerId: 'provider-a',
      externalTransactionId: 'external-701',
      idempotencyKey: 'provider-a:external-701',
      playerId: PLAYER_ID,
      walletId: WALLET_ID,
      roundId: 'round-701',
      gameId: 'game-701',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    },
    ...overrides,
  });
}

describe('SQS wager message boundary', () => {
  test('reuses the HTTP use case with persistent delivery metadata', async () => {
    const info = mock(
      (_event: string, _context: OperationalLogContext) => undefined,
    );
    const execute = mock(async () => ({
      transactionId: '30000000-0000-4000-8000-000000000701',
      status: WagerTransactionStatus.Processed,
      idempotentReplay: false,
    }));
    const digested: string[] = [];
    const handler = new SqsWagerMessageHandler(
      { execute } as unknown as ProcessWagerTransactionUseCase,
      {
        digest: (canonicalJson: string) => {
          digested.push(canonicalJson);
          return 'message-payload-hash-701';
        },
      } satisfies PayloadDigest,
      { now: () => new Date(RECEIVED_AT) } satisfies Clock,
      operationalLogger({ info }),
    );

    await handler.handle(body(), WALLET_ID);

    expect(execute).toHaveBeenCalledWith({
      providerId: 'provider-a',
      externalTransactionId: 'external-701',
      idempotencyKey: 'provider-a:external-701',
      playerId: PLAYER_ID,
      walletId: WALLET_ID,
      roundId: 'round-701',
      gameId: 'game-701',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: 'message-701',
      delivery: {
        consumerName: 'wager-transactions-consumer',
        messageId: 'message-701',
        payloadHash: 'message-payload-hash-701',
        receivedAt: RECEIVED_AT,
      },
    });
    expect(digested[0]).toBe(
      '{"data":{"externalTransactionId":"external-701","gameId":"game-701","idempotencyKey":"provider-a:external-701","kind":"BET","money":{"amount":"25.00","currency":"BRL"},"playerId":"10000000-0000-4000-8000-000000000701","providerId":"provider-a","roundId":"round-701","walletId":"20000000-0000-4000-8000-000000000701"},"messageId":"message-701","occurredAt":"2026-10-08T20:59:59.000Z","type":"WagerTransactionRequested"}',
    );
    expect(info).toHaveBeenCalledWith(
      'sqs.wager.completed',
      expect.objectContaining({
        correlationId: 'message-701',
        messageId: 'message-701',
        walletId: WALLET_ID,
        providerId: 'provider-a',
        operation: 'BET',
        status: WagerTransactionStatus.Processed,
      }),
    );
    const loggedContext = info.mock.calls[0]?.[1];
    expect(JSON.stringify(loggedContext)).not.toContain('25.00');
    expect(JSON.stringify(loggedContext)).not.toContain(
      'provider-a:external-701',
    );
  });

  test.each([
    undefined,
    '',
    '{',
    '{}',
    body({ type: 'UnexpectedMessage' }),
    body({ extra: true }),
    JSON.stringify({
      messageId: 'message-701',
      type: 'WagerTransactionRequested',
      occurredAt: 'invalid',
      data: {},
    }),
  ])('rejects an invalid or unsupported body before the use case', async (raw) => {
    const execute = mock(async () => undefined);
    const handler = handlerWith(execute);

    await expect(handler.handle(raw, WALLET_ID)).rejects.toBeInstanceOf(
      InvalidSqsWagerMessageError,
    );
    expect(execute).toHaveBeenCalledTimes(0);
  });

  test('rejects a FIFO group that does not identify the target wallet', async () => {
    const execute = mock(async () => undefined);
    const handler = handlerWith(execute);

    await expect(
      handler.handle(body(), 'another-wallet'),
    ).rejects.toBeInstanceOf(InvalidSqsMessageGroupError);
    expect(execute).toHaveBeenCalledTimes(0);
  });
});

function handlerWith(execute: ReturnType<typeof mock>): SqsWagerMessageHandler {
  return new SqsWagerMessageHandler(
    { execute } as unknown as ProcessWagerTransactionUseCase,
    { digest: () => 'hash' } satisfies PayloadDigest,
    { now: () => new Date(RECEIVED_AT) } satisfies Clock,
  );
}

function operationalLogger(overrides: Partial<OperationalLogger> = {}): OperationalLogger {
  return {
    info: overrides.info ?? (() => undefined),
    warn: overrides.warn ?? (() => undefined),
    error: overrides.error ?? (() => undefined),
  };
}
