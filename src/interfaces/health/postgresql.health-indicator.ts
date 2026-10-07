import { MikroORM } from '@mikro-orm/core';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { HealthIndicatorService } from '@nestjs/terminus';

import { HEALTH_DEPENDENCY_TIMEOUT_MS } from './health.constants.js';

@Injectable()
export class PostgresqlHealthIndicator {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly healthIndicator: HealthIndicatorService,
  ) {}

  check() {
    return this.healthIndicator
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
  }
}
