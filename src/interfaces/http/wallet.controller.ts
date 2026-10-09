import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  Inject,
} from '@nestjs/common';

import {
  OPERATIONAL_LOGGER,
  NOOP_OPERATIONAL_LOGGER,
  type OperationalLogger,
} from '../../application/ports/operational-logger.js';
import { CreateWalletUseCase } from '../../application/use-cases/wallet/create-wallet.use-case.js';
import { GetWalletLedgerUseCase } from '../../application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { GetWalletUseCase } from '../../application/use-cases/wallet/get-wallet.use-case.js';
import { ReconcileWalletUseCase } from '../../application/use-cases/wallet/reconcile-wallet.use-case.js';
import { resolveCorrelationId } from './correlation-id.js';
import { DeferredProviderAuthenticationGuard } from './deferred-provider-auth.guard.js';
import {
  createWalletBodySchema,
  walletIdParamsSchema,
  walletLedgerQuerySchema,
} from './http-contracts.js';
import { parseHttpContract } from './http-contract-validation.js';

@Controller('wallets')
@UseGuards(DeferredProviderAuthenticationGuard)
export class WalletController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly getWalletLedger: GetWalletLedgerUseCase,
    private readonly reconcileWallet: ReconcileWalletUseCase,
    @Inject(OPERATIONAL_LOGGER)
    private readonly logger: OperationalLogger = NOOP_OPERATIONAL_LOGGER,
  ) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Headers('x-correlation-id') correlationIdHeader: unknown,
  ) {
    const startedAt = performance.now();
    const command = parseHttpContract(createWalletBodySchema, body);
    const correlationId = resolveCorrelationId(correlationIdHeader);
    const result = await this.createWallet.execute({
      ...command,
      correlationId,
    });

    this.logger.info('wallet.created', {
      correlationId,
      walletId: result.id,
      operation: 'OPENING',
      status: 'PROCESSED',
      durationMs: elapsedMilliseconds(startedAt),
    });
    return result;
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
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Param() params: unknown,
    @Headers('x-correlation-id') correlationIdHeader: unknown,
  ) {
    const startedAt = performance.now();
    const { walletId } = parseHttpContract(walletIdParamsSchema, params);
    const correlationId = resolveCorrelationId(correlationIdHeader);
    const result = await this.reconcileWallet.execute(walletId);

    const context = {
      correlationId,
      walletId,
      operation: 'RECONCILIATION',
      status: result.consistent ? 'CONSISTENT' : 'DIVERGENT',
      durationMs: elapsedMilliseconds(startedAt),
    } as const;
    if (result.consistent) {
      this.logger.info('wallet.reconciled', context);
    } else {
      this.logger.warn('wallet.reconciliation.diverged', context);
    }
    return result;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}
