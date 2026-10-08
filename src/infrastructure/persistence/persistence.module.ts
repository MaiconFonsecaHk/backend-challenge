import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { PERSISTENCE_UNIT_OF_WORK } from '../../application/ports/persistence/unit-of-work.js';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { MikroOrmUnitOfWork } from './mikro-orm.unit-of-work.js';
import { createMikroOrmOptions } from './mikro-orm.options.js';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ) => createMikroOrmOptions(config),
    }),
  ],
  providers: [
    {
      provide: PERSISTENCE_UNIT_OF_WORK,
      useClass: MikroOrmUnitOfWork,
    },
  ],
  exports: [PERSISTENCE_UNIT_OF_WORK],
})
export class PersistenceModule {}
