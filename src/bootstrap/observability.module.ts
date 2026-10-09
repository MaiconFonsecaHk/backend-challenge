import { Global, Module } from '@nestjs/common';

import { OPERATIONAL_LOGGER } from '../application/ports/operational-logger.js';
import { OPERATIONAL_METRICS } from '../application/ports/operational-metrics.js';
import { NestOperationalLogger } from '../infrastructure/observability/nest-operational.logger.js';
import { PrometheusOperationalMetrics } from '../infrastructure/observability/prometheus-operational.metrics.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { MetricsController } from '../interfaces/metrics/metrics.controller.js';

@Global()
@Module({
  imports: [PersistenceModule],
  controllers: [MetricsController],
  providers: [
    {
      provide: OPERATIONAL_LOGGER,
      useFactory: () => new NestOperationalLogger(),
    },
    {
      provide: OPERATIONAL_METRICS,
      useFactory: () => new PrometheusOperationalMetrics(),
    },
    SystemClock,
  ],
  exports: [OPERATIONAL_LOGGER, OPERATIONAL_METRICS],
})
export class ObservabilityModule {}
