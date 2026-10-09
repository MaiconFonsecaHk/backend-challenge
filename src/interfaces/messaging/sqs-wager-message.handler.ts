import { Inject, Injectable } from '@nestjs/common';

import type { Clock } from '../../application/ports/clock.js';
import {
  OPERATIONAL_LOGGER,
  NOOP_OPERATIONAL_LOGGER,
  type OperationalLogger,
} from '../../application/ports/operational-logger.js';
import type { PayloadDigest } from '../../application/ports/payload-digest.js';
import type { ProcessWagerTransactionResult } from '../../application/ports/wager-transaction-processor.js';
import { serializeCanonicalJson } from '../../application/serialization/canonical-json.js';
import { ProcessWagerTransactionUseCase } from '../../application/use-cases/wagering/process-wager-transaction.use-case.js';
import type { CanonicalJsonValue } from '../../application/serialization/canonical-json.js';
import { InvalidSqsMessageGroupError } from './sqs-wager-message.error.js';
import {
  parseSqsWagerMessage,
  type SqsWagerMessage,
} from './sqs-wager-message.contract.js';

export const WAGER_TRANSACTIONS_CONSUMER_NAME =
  'wager-transactions-consumer';

@Injectable()
export class SqsWagerMessageHandler {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly payloadDigest: PayloadDigest,
    private readonly clock: Clock,
    @Inject(OPERATIONAL_LOGGER)
    private readonly logger: OperationalLogger = NOOP_OPERATIONAL_LOGGER,
  ) {}

  async handle(
    body: string | undefined,
    messageGroupId: string | undefined,
  ): Promise<ProcessWagerTransactionResult> {
    const startedAt = performance.now();
    const message = parseSqsWagerMessage(body);
    if (messageGroupId !== message.data.walletId) {
      throw new InvalidSqsMessageGroupError();
    }

    const result = await this.processWagerTransaction.execute({
      ...message.data,
      correlationId: message.messageId,
      delivery: {
        consumerName: WAGER_TRANSACTIONS_CONSUMER_NAME,
        messageId: message.messageId,
        payloadHash: this.payloadDigest.digest(
          serializeCanonicalJson(
            message as unknown as CanonicalJsonValue,
          ),
        ),
        receivedAt: this.clock.now(),
      },
    });

    this.logger.info(
      result.idempotentReplay ? 'sqs.wager.replayed' : 'sqs.wager.completed',
      {
        correlationId: message.messageId,
        messageId: message.messageId,
        transactionId: result.transactionId,
        walletId: message.data.walletId,
        providerId: message.data.providerId,
        operation: message.data.kind,
        status: result.status,
        ...(result.failureCode === undefined
          ? {}
          : { failureCode: result.failureCode }),
        idempotentReplay: result.idempotentReplay,
        durationMs: elapsedMilliseconds(startedAt),
      },
    );
    return result;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}
