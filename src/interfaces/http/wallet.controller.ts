import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';

import { CreateWalletUseCase } from '../../application/use-cases/wallet/create-wallet.use-case.js';
import { GetWalletLedgerUseCase } from '../../application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { GetWalletUseCase } from '../../application/use-cases/wallet/get-wallet.use-case.js';
import { ReconcileWalletUseCase } from '../../application/use-cases/wallet/reconcile-wallet.use-case.js';
import { resolveCorrelationId } from './correlation-id.js';
import {
  createWalletBodySchema,
  walletIdParamsSchema,
  walletLedgerQuerySchema,
} from './http-contracts.js';
import { parseHttpContract } from './http-contract-validation.js';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly getWalletLedger: GetWalletLedgerUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
  ) {}

  @Post()
  create(
    @Body() body: unknown,
    @Headers('x-correlation-id') correlationIdHeader: unknown,
  ) {
    const command = parseHttpContract(createWalletBodySchema, body);

    return this.createWallet.execute({
      ...command,
      correlationId: resolveCorrelationId(correlationIdHeader),
    });
  }

  @Get(':walletId/ledger')
  ledger(@Param() params: unknown, @Query() query: unknown) {
    const { walletId } = parseHttpContract(walletIdParamsSchema, params);
    const page = parseHttpContract(walletLedgerQuerySchema, query);

    return this.getWalletLedger.execute({ walletId, ...page });
  }

  @Get(':walletId')
  get(@Param() params: unknown) {
    const { walletId } = parseHttpContract(walletIdParamsSchema, params);

    return this.getWallet.execute(walletId);
  }

  @Post(':walletId/reconciliation')
  reconcile(@Param() params: unknown) {
    const { walletId } = parseHttpContract(walletIdParamsSchema, params);

    return this.reconcileWallet.execute(walletId);
  }
}
