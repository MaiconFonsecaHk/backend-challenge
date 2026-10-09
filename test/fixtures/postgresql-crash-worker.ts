import { MikroORM } from '@mikro-orm/postgresql';

import { MikroOrmUnitOfWork } from '../../src/infrastructure/persistence/mikro-orm.unit-of-work.js';
import { PERSISTENCE_ENTITIES } from '../../src/infrastructure/persistence/entities/persistence-entities.js';

const databaseName = requiredEnvironment('CRASH_TEST_DATABASE');
const now = new Date(requiredEnvironment('CRASH_TEST_NOW'));
if (Number.isNaN(now.getTime())) {
  throw new Error('CRASH_TEST_NOW must be a valid timestamp.');
}

const orm = await MikroORM.init({
  dbName: databaseName,
  entities: [...PERSISTENCE_ENTITIES],
  host: process.env.POSTGRES_HOST ?? '127.0.0.1',
  password: process.env.POSTGRES_PASSWORD ?? 'backend_challenge_local',
  pool: { max: 1, min: 1 },
  port: Number(process.env.POSTGRES_PORT ?? '5432'),
  user: process.env.POSTGRES_USER ?? 'backend_challenge',
});

await new MikroOrmUnitOfWork(orm).execute(async (repositories) => {
  const messages = await repositories.outboxMessages.findDueForUpdate(now, 1);
  const claimed = messages[0];
  if (claimed === undefined) {
    throw new Error('Crash worker found no due outbox message.');
  }

  process.stdout.write(`CLAIMED:${claimed.id}\n`);
  await new Promise<never>(() => undefined);
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
