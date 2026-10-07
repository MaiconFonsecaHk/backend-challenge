import type { MikroOrmModuleOptions } from '@mikro-orm/nestjs';
import type { ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../config/environment.schema.js';

export function createMikroOrmOptions(
  config: ConfigService<EnvironmentVariables, true>,
): MikroOrmModuleOptions {
  return {
    autoLoadEntities: true,
    dbName: config.get('POSTGRES_DB', { infer: true }),
    discovery: {
      warnWhenNoEntities: false,
    },
    host: config.get('POSTGRES_HOST', { infer: true }),
    password: config.get('POSTGRES_PASSWORD', { infer: true }),
    port: config.get('POSTGRES_PORT', { infer: true }),
    user: config.get('POSTGRES_USER', { infer: true }),
  };
}
