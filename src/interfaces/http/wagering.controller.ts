import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';

import {
  GetProviderWagerTransactionUseCase,
  GetWagerTransactionByIdUseCase,
} from '../../application/use-cases/wagering/get-wager-transaction.use-cases.js';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/wagering/process-wager-transaction.use-case.js';
import { resolveCorrelationId } from './correlation-id.js';
import {
  idempotencyKeyHeaderSchema,
  processWagerBodySchema,
  providerTransactionParamsSchema,
  transactionIdParamsSchema,
} from './http-contracts.js';
import { parseHttpContract } from './http-contract-validation.js';

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly getWagerTransactionById: GetWagerTransactionByIdUseCase,
  ) {}

  @Post()
  process(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKeyHeader: unknown,
    @Headers('x-correlation-id') correlationIdHeader: unknown,
  ) {
    const command = parseHttpContract(processWagerBodySchema, body);
    const idempotencyKey = parseHttpContract(
      idempotencyKeyHeaderSchema,
      idempotencyKeyHeader,
    );

    return this.processWagerTransaction.execute({
      ...command,
      idempotencyKey,
      correlationId: resolveCorrelationId(correlationIdHeader),
    });
  }

  @Get(':transactionId')
  get(@Param() params: unknown) {
    const { transactionId } = parseHttpContract(
      transactionIdParamsSchema,
      params,
    );

    return this.getWagerTransactionById.execute(transactionId);
  }
}

@Controller('providers/:providerId/wagering/transactions')
export class ProviderWageringController {
  constructor(
    private readonly getProviderWagerTransaction: GetProviderWagerTransactionUseCase,
  ) {}

  @Get(':externalTransactionId')
  get(@Param() params: unknown) {
    const query = parseHttpContract(providerTransactionParamsSchema, params);

    return this.getProviderWagerTransaction.execute(query);
  }
}
