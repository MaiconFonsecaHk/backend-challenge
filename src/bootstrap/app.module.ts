import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { environmentSchema } from '../config/environment.schema.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { HealthModule } from '../interfaces/health/health.module.js';
import { WageringApplicationModule } from './wagering-application.module.js';
import { WalletApplicationModule } from './wallet-application.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      skipProcessEnv: true,
      validationSchema: environmentSchema,
    }),
    PersistenceModule,
    WalletApplicationModule,
    WageringApplicationModule,
    HealthModule,
  ],
})
export class AppModule {}
