import { describe, expect, mock, test } from 'bun:test';
import { HttpStatus } from '@nestjs/common';
import type {
  OperationalLogContext,
  OperationalLogger,
} from '../../../src/application/ports/operational-logger.js';
import type { OperationalMetrics } from '../../../src/application/ports/operational-metrics.js';
import type { CreateWalletUseCase } from '../../../src/application/use-cases/wallet/create-wallet.use-case.js';
import type { GetWalletLedgerUseCase } from '../../../src/application/use-cases/wallet/get-wallet-ledger.use-case.js';
import type { GetWalletUseCase } from '../../../src/application/use-cases/wallet/get-wallet.use-case.js';
import type { ReconcileWalletUseCase } from '../../../src/application/use-cases/wallet/reconcile-wallet.use-case.js';
import type {
  GetProviderWagerTransactionUseCase,
  GetWagerTransactionByIdUseCase,
} from '../../../src/application/use-cases/wagering/get-wager-transaction.use-cases.js';
import type { ProcessWagerTransactionUseCase } from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction.js';
import { WalletController } from '../../../src/interfaces/http/wallet.controller.js';
import {
  ProviderWageringController,
  WageringController,
} from '../../../src/interfaces/http/wagering.controller.js';

const PLAYER_ID = '10000000-0000-4000-8000-000000000602';
const WALLET_ID = '20000000-0000-4000-8000-000000000602';
const TRANSACTION_ID = '30000000-0000-4000-8000-000000000602';

describe('HTTP controllers', () => {
  test('delegates wallet creation with validated transport metadata', async () => {
    const info = mock(
      (_event: string, _context: OperationalLogContext) => undefined,
    );
    const logger = operationalLogger({ info });
    const execute = mock(async () => ({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      balance: { amount: '10.00', currency: 'BRL' },
      version: 1,
    }));
    const controller = walletController({ createWalletExecute: execute, logger });

    await controller.create(
      {
        playerId: PLAYER_ID,
        initialBalance: { amount: '10.00', currency: 'BRL' },
      },
      'correlation-1',
    );

    expect(execute).toHaveBeenCalledWith({
      playerId: PLAYER_ID,
      initialBalance: { amount: '10.00', currency: 'BRL' },
      correlationId: 'correlation-1',
    });
    expect(info).toHaveBeenCalledWith(
      'wallet.created',
      expect.objectContaining({
        correlationId: 'correlation-1',
        walletId: WALLET_ID,
        operation: 'OPENING',
        status: 'PROCESSED',
      }),
    );
    const loggedContext = info.mock.calls[0]?.[1];
    expect(JSON.stringify(loggedContext)).not.toContain('10.00');
  });

  test('delegates wallet queries with validated path and pagination', async () => {
    const getExecute = mock(async () => ({ id: WALLET_ID }));
    const ledgerExecute = mock(async () => ({ items: [] }));
    const reconcileExecute = mock(async () => ({
      walletId: WALLET_ID,
      storedBalance: { amount: '10.00', currency: 'BRL' },
      calculatedBalance: { amount: '10.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    }));
    const controller = walletController({
      getWalletExecute: getExecute,
      getLedgerExecute: ledgerExecute,
      reconcileExecute,
    });

    await controller.get({ walletId: WALLET_ID });
    await controller.ledger({ walletId: WALLET_ID }, { limit: '50' });
    await controller.reconcile({ walletId: WALLET_ID }, 'correlation-reconcile');

    expect(getExecute).toHaveBeenCalledWith(WALLET_ID);
    expect(ledgerExecute).toHaveBeenCalledWith({ walletId: WALLET_ID, limit: 50 });
    expect(reconcileExecute).toHaveBeenCalledWith(WALLET_ID);
  });

  test('counts a reconciliation divergence without using wallet identity as a metric label', async () => {
    const recordReconciliationDivergence = mock(() => undefined);
    const controller = walletController({
      reconcileExecute: mock(async () => ({
        walletId: WALLET_ID,
        storedBalance: { amount: '11.00', currency: 'BRL' },
        calculatedBalance: { amount: '10.00', currency: 'BRL' },
        difference: { amount: '1.00', currency: 'BRL' },
        consistent: false,
        checkedEntries: 1,
      })),
      metrics: operationalMetrics({ recordReconciliationDivergence }),
    });

    await controller.reconcile(
      { walletId: WALLET_ID },
      'correlation-divergence',
    );

    expect(recordReconciliationDivergence).toHaveBeenCalledWith();
  });

  test('uses the Idempotency-Key header as the only transport source', async () => {
    const info = mock(
      (_event: string, _context: OperationalLogContext) => undefined,
    );
    const execute = mock(async () => ({
      transactionId: TRANSACTION_ID,
      status: 'PROCESSED',
      idempotentReplay: false,
    }));
    const controller = wageringController(execute, undefined, operationalLogger({ info }));
    const setStatus = mock(() => undefined);

    await controller.process(
      {
        providerId: 'provider-a',
        externalTransactionId: 'transaction-123',
        playerId: PLAYER_ID,
        walletId: WALLET_ID,
        roundId: 'round-987',
        gameId: 'fortune-chimp',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      },
      'provider-a:transaction-123',
      'correlation-2',
      { status: setStatus },
    );

    expect(execute).toHaveBeenCalledWith({
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
      playerId: PLAYER_ID,
      walletId: WALLET_ID,
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
      idempotencyKey: 'provider-a:transaction-123',
      correlationId: 'correlation-2',
    });
    expect(setStatus).toHaveBeenCalledWith(HttpStatus.OK);
    expect(info).toHaveBeenCalledWith(
      'wager.completed',
      expect.objectContaining({
        correlationId: 'correlation-2',
        transactionId: TRANSACTION_ID,
        walletId: WALLET_ID,
        providerId: 'provider-a',
        operation: WagerTransactionKind.Bet,
        status: 'PROCESSED',
        idempotentReplay: false,
      }),
    );
    const loggedContext = info.mock.calls[0]?.[1];
    expect(JSON.stringify(loggedContext)).not.toContain('25.00');
    expect(JSON.stringify(loggedContext)).not.toContain(
      'provider-a:transaction-123',
    );
  });

  test('delegates both transaction lookup routes', async () => {
    const byIdExecute = mock(async () => ({ transactionId: TRANSACTION_ID }));
    const byProviderExecute = mock(async () => ({
      transactionId: TRANSACTION_ID,
    }));
    const wagerController = wageringController(mock(async () => undefined), byIdExecute);
    const providerController = new ProviderWageringController({
      execute: byProviderExecute,
    } as unknown as GetProviderWagerTransactionUseCase);

    await wagerController.get({ transactionId: TRANSACTION_ID });
    await providerController.get({
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
    });

    expect(byIdExecute).toHaveBeenCalledWith(TRANSACTION_ID);
    expect(byProviderExecute).toHaveBeenCalledWith({
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
    });
  });
});

function walletController(options: {
  readonly createWalletExecute?: ReturnType<typeof mock>;
  readonly getWalletExecute?: ReturnType<typeof mock>;
  readonly getLedgerExecute?: ReturnType<typeof mock>;
  readonly reconcileExecute?: ReturnType<typeof mock>;
  readonly logger?: OperationalLogger;
  readonly metrics?: OperationalMetrics;
}): WalletController {
  return new WalletController(
    { execute: options.createWalletExecute ?? mock(async () => undefined) } as unknown as CreateWalletUseCase,
    { execute: options.getWalletExecute ?? mock(async () => undefined) } as unknown as GetWalletUseCase,
    { execute: options.getLedgerExecute ?? mock(async () => undefined) } as unknown as GetWalletLedgerUseCase,
    { execute: options.reconcileExecute ?? mock(async () => undefined) } as unknown as ReconcileWalletUseCase,
    options.logger,
    options.metrics,
  );
}

function wageringController(
  processExecute: ReturnType<typeof mock>,
  getExecute: ReturnType<typeof mock> = mock(async () => undefined),
  logger?: OperationalLogger,
): WageringController {
  return new WageringController(
    { execute: processExecute } as unknown as ProcessWagerTransactionUseCase,
    { execute: getExecute } as unknown as GetWagerTransactionByIdUseCase,
    logger,
  );
}

function operationalLogger(overrides: Partial<OperationalLogger> = {}): OperationalLogger {
  return {
    info: overrides.info ?? (() => undefined),
    warn: overrides.warn ?? (() => undefined),
    error: overrides.error ?? (() => undefined),
  };
}

function operationalMetrics(overrides: Partial<OperationalMetrics>): OperationalMetrics {
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
