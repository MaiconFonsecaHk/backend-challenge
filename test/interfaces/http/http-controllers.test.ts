import { describe, expect, mock, test } from 'bun:test';
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
    const execute = mock(async () => ({
      id: WALLET_ID,
      playerId: PLAYER_ID,
      balance: { amount: '10.00', currency: 'BRL' },
      version: 1,
    }));
    const controller = walletController({ createWalletExecute: execute });

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
  });

  test('delegates wallet queries with validated path and pagination', async () => {
    const getExecute = mock(async () => ({ id: WALLET_ID }));
    const ledgerExecute = mock(async () => ({ items: [] }));
    const reconcileExecute = mock(async () => ({ walletId: WALLET_ID }));
    const controller = walletController({
      getWalletExecute: getExecute,
      getLedgerExecute: ledgerExecute,
      reconcileExecute,
    });

    await controller.get({ walletId: WALLET_ID });
    await controller.ledger({ walletId: WALLET_ID }, { limit: '50' });
    await controller.reconcile({ walletId: WALLET_ID });

    expect(getExecute).toHaveBeenCalledWith(WALLET_ID);
    expect(ledgerExecute).toHaveBeenCalledWith({ walletId: WALLET_ID, limit: 50 });
    expect(reconcileExecute).toHaveBeenCalledWith(WALLET_ID);
  });

  test('uses the Idempotency-Key header as the only transport source', async () => {
    const execute = mock(async () => ({
      transactionId: TRANSACTION_ID,
      status: 'PROCESSED',
      idempotentReplay: false,
    }));
    const controller = wageringController(execute);

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
}): WalletController {
  return new WalletController(
    { execute: options.createWalletExecute ?? mock(async () => undefined) } as unknown as CreateWalletUseCase,
    { execute: options.getWalletExecute ?? mock(async () => undefined) } as unknown as GetWalletUseCase,
    { execute: options.getLedgerExecute ?? mock(async () => undefined) } as unknown as GetWalletLedgerUseCase,
    { execute: options.reconcileExecute ?? mock(async () => undefined) } as unknown as ReconcileWalletUseCase,
  );
}

function wageringController(
  processExecute: ReturnType<typeof mock>,
  getExecute: ReturnType<typeof mock> = mock(async () => undefined),
): WageringController {
  return new WageringController(
    { execute: processExecute } as unknown as ProcessWagerTransactionUseCase,
    { execute: getExecute } as unknown as GetWagerTransactionByIdUseCase,
  );
}
