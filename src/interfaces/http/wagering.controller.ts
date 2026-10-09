import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';

import {
  GetProviderWagerTransactionUseCase,
  GetWagerTransactionByIdUseCase,
} from '../../application/use-cases/wagering/get-wager-transaction.use-cases.js';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/wagering/process-wager-transaction.use-case.js';
import { resolveCorrelationId } from './correlation-id.js';
import { DeferredProviderAuthenticationGuard } from './deferred-provider-auth.guard.js';
import {
  idempotencyKeyHeaderSchema,
  processWagerBodySchema,
  providerTransactionParamsSchema,
  transactionIdParamsSchema,
} from './http-contracts.js';
import { parseHttpContract } from './http-contract-validation.js';
import {
  type HttpStatusResponse,
  respondWithWagerResult,
} from './wager-http-response.js';

@Controller('wagering/transactions')
@UseGuards(DeferredProviderAuthenticationGuard)
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly getWagerTransactionById: GetWagerTransactionByIdUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async process(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKeyHeader: unknown,
    @Headers('x-correlation-id') correlationIdHeader: unknown,
    @Res({ passthrough: true }) response: HttpStatusResponse,
  ) {
    const command = parseHttpContract(processWagerBodySchema, body);
    const idempotencyKey = parseHttpContract(
      idempotencyKeyHeaderSchema,
      idempotencyKeyHeader,
    );

    const result = await this.processWagerTransaction.execute({
      ...command,
      idempotencyKey,
      correlationId: resolveCorrelationId(correlationIdHeader),
    });

    return respondWithWagerResult(response, result);
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
@UseGuards(DeferredProviderAuthenticationGuard)
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
