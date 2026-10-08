import type { MikroOrmModuleOptions } from '@mikro-orm/nestjs';
import type { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { PERSISTENCE_ENTITIES } from './entities/persistence-entities.js';

export function createMikroOrmOptions(
  config: ConfigService<EnvironmentVariables, true>,
): MikroOrmModuleOptions {
  return {
    dbName: config.get('POSTGRES_DB', { infer: true }),
    entities: [...PERSISTENCE_ENTITIES],
    host: config.get('POSTGRES_HOST', { infer: true }),
    password: config.get('POSTGRES_PASSWORD', { infer: true }),
    port: config.get('POSTGRES_PORT', { infer: true }),
    user: config.get('POSTGRES_USER', { infer: true }),
  };
}
