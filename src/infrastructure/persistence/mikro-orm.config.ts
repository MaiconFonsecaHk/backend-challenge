import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

import { databaseEnvironmentSchema } from '../../config/environment.schema.js';
import { PERSISTENCE_ENTITIES } from './entities/persistence-entities.js';

const environment = databaseEnvironmentSchema.parse(process.env);

export default defineConfig({
  dbName: environment.POSTGRES_DB,
  entities: [...PERSISTENCE_ENTITIES],
  extensions: [Migrator],
  host: environment.POSTGRES_HOST,
  migrations: {
    allOrNothing: true,
    emit: 'ts',
    path: './dist/infrastructure/persistence/migrations',
    pathTs: './src/infrastructure/persistence/migrations',
    snapshot: true,
    snapshotName: '.snapshot-backend-challenge',
    snapshotOnMigrate: false,
    transactional: true,
  },
  password: environment.POSTGRES_PASSWORD,
  port: environment.POSTGRES_PORT,
  user: environment.POSTGRES_USER,
});
