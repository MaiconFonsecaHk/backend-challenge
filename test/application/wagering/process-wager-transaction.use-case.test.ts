import { describe, expect, mock, test } from 'bun:test';

import {
  ExternalOpeningNotAllowedError,
  InvalidWagerCommandError,
} from '../../../src/application/errors/wager-application.error.js';
import type { PayloadDigest } from '../../../src/application/ports/payload-digest.js';
import type {
  OperationalMetrics,
  WagerOutcomeMetric,
} from '../../../src/application/ports/operational-metrics.js';
import type {
  ProcessWagerTransactionResult,
  WagerTransactionProcessor,
  WagerTransactionProcessingCommand,
} from '../../../src/application/ports/wager-transaction-processor.js';
import { WagerPayloadFingerprintService } from '../../../src/application/services/wager-payload-fingerprint.js';
import {
  type ProcessWagerTransactionCommand,
  ProcessWagerTransactionUseCase,
} from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import { InvalidMoneyAmountError } from '../../../src/domain/shared/errors/money.error.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';

const TRANSACTION_ID = '30000000-0000-4000-8000-000000000501';

function command(
  overrides: Partial<ProcessWagerTransactionCommand> = {},
): ProcessWagerTransactionCommand {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'external-501',
    idempotencyKey: 'provider-a:external-501',
    playerId: '20000000-0000-4000-8000-000000000501',
    walletId: '10000000-0000-4000-8000-000000000501',
    roundId: 'round-501',
    gameId: 'game-501',
    kind: WagerTransactionKind.Bet,
    money: { amount: '025.00', currency: 'BRL' },
    correlationId: 'correlation-501',
    ...overrides,
  };
}

class ProcessorDouble implements WagerTransactionProcessor {
  readonly commands: WagerTransactionProcessingCommand[] = [];

  constructor(private readonly result: ProcessWagerTransactionResult) {}

  async process(
    normalized: WagerTransactionProcessingCommand,
  ): Promise<ProcessWagerTransactionResult> {
    this.commands.push(normalized);
    return this.result;
  }
}

class PayloadDigestDouble implements PayloadDigest {
  readonly canonicalPayloads: string[] = [];

  digest(canonicalJson: string): string {
    this.canonicalPayloads.push(canonicalJson);

    return 'payload-digest';
  }
}

function createUseCase(
  processor: WagerTransactionProcessor,
  metrics?: OperationalMetrics,
): {
  readonly useCase: ProcessWagerTransactionUseCase;
  readonly digest: PayloadDigestDouble;
} {
  const digest = new PayloadDigestDouble();

  return {
    useCase: new ProcessWagerTransactionUseCase(
      processor,
      new WagerPayloadFingerprintService(digest),
      metrics,
    ),
    digest,
  };
}

function processedResult(): ProcessWagerTransactionResult {
  return {
    transactionId: TRANSACTION_ID,
    status: WagerTransactionStatus.Processed,
    balance: { amount: '75.00', currency: 'BRL' },
    idempotentReplay: false,
  };
}

describe('ProcessWagerTransactionUseCase', () => {
  test('normalizes one transport-neutral command and delegates it once', async () => {
    const processor = new ProcessorDouble(processedResult());
    const { useCase, digest } = createUseCase(processor);

    const result = await useCase.execute(command());

    expect(processor.commands).toEqual([
      {
        providerId: 'provider-a',
        externalTransactionId: 'external-501',
        idempotencyKey: 'provider-a:external-501',
        playerId: '20000000-0000-4000-8000-000000000501',
        walletId: '10000000-0000-4000-8000-000000000501',
        roundId: 'round-501',
        gameId: 'game-501',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
        correlationId: 'correlation-501',
        payloadHash: 'payload-digest',
      },
    ]);
    expect(digest.canonicalPayloads).toEqual([
      '{"externalTransactionId":"external-501","gameId":"game-501","kind":"BET","money":{"amount":"25.00","currency":"BRL"},"playerId":"20000000-0000-4000-8000-000000000501","providerId":"provider-a","roundId":"round-501","walletId":"10000000-0000-4000-8000-000000000501"}',
    ]);
    expect(Object.isFrozen(processor.commands[0])).toBe(true);
    expect(Object.isFrozen(processor.commands[0]?.money)).toBe(true);
    expect(result).toEqual(processedResult());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.balance)).toBe(true);
  });

  test('preserves optional reference and stable rejected result fields', async () => {
    const processor = new ProcessorDouble({
      transactionId: TRANSACTION_ID,
      status: WagerTransactionStatus.Rejected,
      failureCode: 'INVALID_REFERENCE',
      idempotentReplay: true,
    });
    const { useCase } = createUseCase(processor);

    const result = await useCase.execute(
      command({
        kind: WagerTransactionKind.Refund,
        referenceExternalTransactionId: 'referenced-bet',
      }),
    );

    expect(processor.commands[0]?.referenceExternalTransactionId).toBe(
      'referenced-bet',
    );
    expect(result).toEqual({
      transactionId: TRANSACTION_ID,
      status: WagerTransactionStatus.Rejected,
      failureCode: 'INVALID_REFERENCE',
      idempotentReplay: true,
    });
  });

  test('preserves validated delivery metadata without adding it to the business hash', async () => {
    const processor = new ProcessorDouble(processedResult());
    const { useCase, digest } = createUseCase(processor);
    const receivedAt = new Date('2026-10-08T20:00:00.000Z');

    await useCase.execute(
      command({
        delivery: {
          consumerName: 'wager-transactions-consumer',
          messageId: 'message-501',
          payloadHash: 'message-payload-hash',
          receivedAt,
        },
      }),
    );

    expect(processor.commands[0]?.delivery).toEqual({
      consumerName: 'wager-transactions-consumer',
      messageId: 'message-501',
      payloadHash: 'message-payload-hash',
      receivedAt,
    });
    expect(processor.commands[0]?.delivery?.receivedAt).not.toBe(receivedAt);
    expect(digest.canonicalPayloads[0]).not.toContain('message-501');
  });

  test('records status, duplicate detection, source and processing latency', async () => {
    const recordWagerOutcome = mock((_outcome: WagerOutcomeMetric) => undefined);
    const metrics = metricsDouble({ recordWagerOutcome });
    const processor = new ProcessorDouble({
      ...processedResult(),
      idempotentReplay: true,
    });
    const { useCase } = createUseCase(processor, metrics);

    await useCase.execute(
      command({
        delivery: {
          consumerName: 'wager-transactions-consumer',
          messageId: 'message-501',
          payloadHash: 'message-payload-hash',
          receivedAt: new Date('2026-10-08T20:00:00.000Z'),
        },
      }),
    );

    expect(recordWagerOutcome).toHaveBeenCalledWith({
      source: 'sqs',
      operation: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      idempotentReplay: true,
      durationSeconds: expect.any(Number),
    });
    const recordedOutcome = recordWagerOutcome.mock.calls[0]?.[0];
    expect(recordedOutcome).toBeDefined();
    expect(recordedOutcome!.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  test.each([
    { consumerName: '', messageId: 'message', payloadHash: 'hash' },
    { consumerName: 'consumer', messageId: ' ', payloadHash: 'hash' },
    { consumerName: 'consumer', messageId: 'message', payloadHash: '' },
  ])('rejects invalid delivery identity %o', async (delivery) => {
    const processor = new ProcessorDouble(processedResult());
    const { useCase } = createUseCase(processor);

    await expect(
      useCase.execute(
        command({
          delivery: {
            ...delivery,
            receivedAt: new Date('2026-10-08T20:00:00.000Z'),
          },
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidWagerCommandError);
    expect(processor.commands).toEqual([]);
  });

  test.each([
    'providerId',
    'externalTransactionId',
    'idempotencyKey',
    'playerId',
    'walletId',
    'roundId',
    'gameId',
    'correlationId',
  ] as const)('rejects an empty %s before invoking the processor', async (field) => {
    const processor = new ProcessorDouble(processedResult());
    const { useCase } = createUseCase(processor);

    await expect(
      useCase.execute(command({ [field]: '   ' })),
    ).rejects.toBeInstanceOf(InvalidWagerCommandError);
    expect(processor.commands).toEqual([]);
  });

  test('rejects OPENING and unknown transaction kinds at the shared boundary', async () => {
    const processor = new ProcessorDouble(processedResult());
    const { useCase } = createUseCase(processor);

    await expect(
      useCase.execute(command({ kind: WagerTransactionKind.Opening })),
    ).rejects.toBeInstanceOf(ExternalOpeningNotAllowedError);
    await expect(
      useCase.execute(
        command({ kind: 'UNKNOWN' as WagerTransactionKind }),
      ),
    ).rejects.toBeInstanceOf(InvalidWagerCommandError);
    expect(processor.commands).toEqual([]);
  });

  test.each([
    [WagerTransactionKind.Refund, undefined],
    [WagerTransactionKind.Rollback, '   '],
    [WagerTransactionKind.Bet, 'reference'],
    [WagerTransactionKind.Loss, 'reference'],
    [WagerTransactionKind.Win, ''],
  ] as const)(
    'rejects invalid reference shape for %s before invoking the processor',
    async (kind, referenceExternalTransactionId) => {
      const processor = new ProcessorDouble(processedResult());
      const { useCase } = createUseCase(processor);

      await expect(
        useCase.execute(
          command({ kind, referenceExternalTransactionId }),
        ),
      ).rejects.toBeInstanceOf(InvalidWagerCommandError);
      expect(processor.commands).toEqual([]);
    },
  );

  test('allows WIN with or without a non-empty reference', async () => {
    const processor = new ProcessorDouble(processedResult());
    const { useCase } = createUseCase(processor);

    await useCase.execute(command({ kind: WagerTransactionKind.Win }));
    await useCase.execute(
      command({
        kind: WagerTransactionKind.Win,
        referenceExternalTransactionId: 'referenced-bet',
      }),
    );

    expect(processor.commands).toHaveLength(2);
    expect(processor.commands[0]?.referenceExternalTransactionId).toBeUndefined();
    expect(processor.commands[1]?.referenceExternalTransactionId).toBe(
      'referenced-bet',
    );
  });

  test('reuses exact Money validation before invoking the processor', async () => {
    const processor = new ProcessorDouble(processedResult());
    const { useCase } = createUseCase(processor);

    await expect(
      useCase.execute(command({ money: { amount: '25.0', currency: 'BRL' } })),
    ).rejects.toBeInstanceOf(InvalidMoneyAmountError);
    expect(processor.commands).toEqual([]);
  });

  test.each(['0.00', '-0.01'])(
    'rejects non-positive wager amount %s before invoking the processor',
    async (amount) => {
      const processor = new ProcessorDouble(processedResult());
      const { useCase } = createUseCase(processor);

      await expect(
        useCase.execute(command({ money: { amount, currency: 'BRL' } })),
      ).rejects.toBeInstanceOf(InvalidWagerCommandError);
      expect(processor.commands).toEqual([]);
    },
  );
});

function metricsDouble(overrides: Partial<OperationalMetrics>): OperationalMetrics {
  return {
    recordWagerOutcome: overrides.recordWagerOutcome ?? (() => undefined),
    recordRetry: overrides.recordRetry ?? (() => undefined),
    recordDeadLetterMessage:
      overrides.recordDeadLetterMessage ?? (() => undefined),
    recordLockConflict: overrides.recordLockConflict ?? (() => undefined),
    recordReconciliationDivergence:
      overrides.recordReconciliationDivergence ?? (() => undefined),
    setOutboxState: overrides.setOutboxState ?? (() => undefined),
    setReadiness: overrides.setReadiness ?? (() => undefined),
    recordCollectionFailure:
      overrides.recordCollectionFailure ?? (() => undefined),
    contentType: () => 'text/plain',
    render: async () => '',
  };
}
