import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { environmentSchema } from '../config/environment.schema.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { HealthModule } from '../interfaces/health/health.module.js';
import { HttpApiModule } from './http-api.module.js';
import { SqsWagerConsumerModule } from './sqs-wager-consumer.module.js';
import { OutboxPublisherModule } from './outbox-publisher.module.js';
import { PendingReferenceWorkerModule } from './pending-reference-worker.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      skipProcessEnv: true,
      validationSchema: environmentSchema,
    }),
    PersistenceModule,
    HttpApiModule,
    SqsWagerConsumerModule,
    OutboxPublisherModule,
    PendingReferenceWorkerModule,
    HealthModule,
  ],
})
export class AppModule {}
