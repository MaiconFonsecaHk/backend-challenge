import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import type { Clock } from '../application/ports/clock.js';
import { CLOCK } from '../application/ports/clock.js';
import {
  OUTBOX_EVENT_TRANSPORT,
  type OutboxEventTransport,
} from '../application/ports/outbox-event-transport.js';
import type { UnitOfWork } from '../application/ports/persistence/unit-of-work.js';
import { PERSISTENCE_UNIT_OF_WORK } from '../application/ports/persistence/unit-of-work.js';
import { ExponentialOutboxRetryPolicy } from '../application/services/exponential-outbox-retry.policy.js';
import { PublishOutboxBatchUseCase } from '../application/use-cases/messaging/publish-outbox-batch.use-case.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { SqsModule } from '../infrastructure/messaging/sqs.module.js';
import { SqsOutboxEventTransport } from '../infrastructure/messaging/sqs-outbox-event.transport.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { OutboxPublisherWorker } from '../interfaces/workers/outbox-publisher.worker.js';

@Module({
  imports: [ConfigModule, PersistenceModule, SqsModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: OUTBOX_EVENT_TRANSPORT,
      useClass: SqsOutboxEventTransport,
    },
    {
      provide: ExponentialOutboxRetryPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new ExponentialOutboxRetryPolicy(
          config.get('OUTBOX_RETRY_BASE_SECONDS', { infer: true }),
          config.get('OUTBOX_RETRY_MAX_SECONDS', { infer: true }),
        ),
    },
    {
      provide: PublishOutboxBatchUseCase,
      inject: [
        PERSISTENCE_UNIT_OF_WORK,
        OUTBOX_EVENT_TRANSPORT,
        CLOCK,
        ExponentialOutboxRetryPolicy,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        transport: OutboxEventTransport,
        clock: Clock,
        retryPolicy: ExponentialOutboxRetryPolicy,
      ) =>
        new PublishOutboxBatchUseCase(
          unitOfWork,
          transport,
          clock,
          retryPolicy,
        ),
    },
    OutboxPublisherWorker,
  ],
})
export class OutboxPublisherModule {}
