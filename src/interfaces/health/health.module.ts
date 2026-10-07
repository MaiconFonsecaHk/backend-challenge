import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { SqsModule } from '../../infrastructure/messaging/sqs.module.js';
import { PersistenceModule } from '../../infrastructure/persistence/persistence.module.js';
import { HealthController } from './health.controller.js';
import { PostgresqlHealthIndicator } from './postgresql.health-indicator.js';
import { SqsHealthIndicator } from './sqs.health-indicator.js';

@Module({
  controllers: [HealthController],
  imports: [PersistenceModule, SqsModule, TerminusModule],
  providers: [PostgresqlHealthIndicator, SqsHealthIndicator],
})
export class HealthModule {}
