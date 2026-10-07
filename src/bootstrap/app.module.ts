import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { environmentSchema } from '../config/environment.schema.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { HealthModule } from '../interfaces/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      skipProcessEnv: true,
      validationSchema: environmentSchema,
    }),
    PersistenceModule,
    HealthModule,
  ],
})
export class AppModule {}
