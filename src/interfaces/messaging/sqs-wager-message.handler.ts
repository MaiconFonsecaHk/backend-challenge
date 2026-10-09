import { Injectable } from '@nestjs/common';

import type { Clock } from '../../application/ports/clock.js';
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
  ) {}

  async handle(
    body: string | undefined,
    messageGroupId: string | undefined,
  ): Promise<ProcessWagerTransactionResult> {
    const message = parseSqsWagerMessage(body);
    if (messageGroupId !== message.data.walletId) {
      throw new InvalidSqsMessageGroupError();
    }

    return this.processWagerTransaction.execute({
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
  }
}
