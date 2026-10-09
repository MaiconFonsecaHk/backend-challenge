import { MikroORM } from '@mikro-orm/core';
import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { HealthIndicatorService } from '@nestjs/terminus';

import {
  OPERATIONAL_METRICS,
  NOOP_OPERATIONAL_METRICS,
  type OperationalMetrics,
} from '../../application/ports/operational-metrics.js';
import { HEALTH_DEPENDENCY_TIMEOUT_MS } from './health.constants.js';

@Injectable()
export class PostgresqlHealthIndicator {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly healthIndicator: HealthIndicatorService,
    @Inject(OPERATIONAL_METRICS)
    private readonly metrics: OperationalMetrics = NOOP_OPERATIONAL_METRICS,
  ) {}

  async check() {
    try {
      const result = await this.healthIndicator
        .check('postgresql')
        .attempt(async () => {
          try {
            const orm = this.moduleRef.get(MikroORM, { strict: false });

            await orm.em.getConnection().execute('select 1;');
          } catch {
            throw new Error('PostgreSQL is unavailable');
          }
        })
        .withTimeout(HEALTH_DEPENDENCY_TIMEOUT_MS);
      this.metrics.setReadiness('postgresql', true);
      return result;
    } catch (error) {
      this.metrics.setReadiness('postgresql', false);
      throw error;
    }
  }
}
