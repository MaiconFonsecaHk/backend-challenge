import { describe, expect, test } from 'bun:test';

import {
  ExternalOpeningNotAllowedError,
  InvalidWagerCommandError,
} from '../../../src/application/errors/wager-application.error.js';
import type {
  NormalizedWagerTransactionCommand,
  ProcessWagerTransactionResult,
  WagerTransactionProcessor,
} from '../../../src/application/ports/wager-transaction-processor.js';
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
  readonly commands: NormalizedWagerTransactionCommand[] = [];

  constructor(private readonly result: ProcessWagerTransactionResult) {}

  async process(
    normalized: NormalizedWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    this.commands.push(normalized);
    return this.result;
  }
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
    const useCase = new ProcessWagerTransactionUseCase(processor);

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
      },
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
    const useCase = new ProcessWagerTransactionUseCase(processor);

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
    const useCase = new ProcessWagerTransactionUseCase(processor);

    await expect(
      useCase.execute(command({ [field]: '   ' })),
    ).rejects.toBeInstanceOf(InvalidWagerCommandError);
    expect(processor.commands).toEqual([]);
  });

  test('rejects OPENING and unknown transaction kinds at the shared boundary', async () => {
    const processor = new ProcessorDouble(processedResult());
    const useCase = new ProcessWagerTransactionUseCase(processor);

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
      const useCase = new ProcessWagerTransactionUseCase(processor);

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
    const useCase = new ProcessWagerTransactionUseCase(processor);

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
    const useCase = new ProcessWagerTransactionUseCase(processor);

    await expect(
      useCase.execute(command({ money: { amount: '25.0', currency: 'BRL' } })),
    ).rejects.toBeInstanceOf(InvalidMoneyAmountError);
    expect(processor.commands).toEqual([]);
  });

  test.each(['0.00', '-0.01'])(
    'rejects non-positive wager amount %s before invoking the processor',
    async (amount) => {
      const processor = new ProcessorDouble(processedResult());
      const useCase = new ProcessWagerTransactionUseCase(processor);

      await expect(
        useCase.execute(command({ money: { amount, currency: 'BRL' } })),
      ).rejects.toBeInstanceOf(InvalidWagerCommandError);
      expect(processor.commands).toEqual([]);
    },
  );
});
