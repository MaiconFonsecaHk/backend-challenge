import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import type { Clock } from '../application/ports/clock.js';
import type { PayloadDigest } from '../application/ports/payload-digest.js';
import { ProcessWagerTransactionUseCase } from '../application/use-cases/wagering/process-wager-transaction.use-case.js';
import { Sha256PayloadDigest } from '../infrastructure/cryptography/sha256-payload-digest.js';
import { SqsModule } from '../infrastructure/messaging/sqs.module.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { SqsWagerConsumer } from '../interfaces/messaging/sqs-wager.consumer.js';
import { SqsWagerMessageHandler } from '../interfaces/messaging/sqs-wager-message.handler.js';
import { WageringApplicationModule } from './wagering-application.module.js';

@Module({
  imports: [ConfigModule, SqsModule, WageringApplicationModule],
  providers: [
    Sha256PayloadDigest,
    SystemClock,
    {
      provide: SqsWagerMessageHandler,
      inject: [
        ProcessWagerTransactionUseCase,
        Sha256PayloadDigest,
        SystemClock,
      ],
      useFactory: (
        useCase: ProcessWagerTransactionUseCase,
        digest: PayloadDigest,
        clock: Clock,
      ) => new SqsWagerMessageHandler(useCase, digest, clock),
    },
    SqsWagerConsumer,
  ],
})
export class SqsWagerConsumerModule {}
