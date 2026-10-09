import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATABASE_ENVIRONMENT_KEYS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
] as const;

describe('MikroORM CLI configuration', () => {
  test('loads database settings from .env in a clean process', async () => {
    const environment = { ...process.env };
    for (const key of DATABASE_ENVIRONMENT_KEYS) {
      delete environment[key];
    }

    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), 'backend-challenge-mikro-orm-'),
    );
    const configurationUrl = pathToFileURL(
      resolve('src/infrastructure/persistence/mikro-orm.config.ts'),
    ).href;
    await writeFile(
      join(fixtureDirectory, '.env'),
      [
        'POSTGRES_HOST=127.0.0.1',
        'POSTGRES_PORT=5432',
        'POSTGRES_DB=cli_config_test',
        'POSTGRES_USER=cli_config_test',
        'POSTGRES_PASSWORD=local_test_only',
      ].join('\n'),
      'utf8',
    );

    try {
      const child = Bun.spawn(
        [
          process.execPath,
          '-e',
          `const configuration = (await import(${JSON.stringify(configurationUrl)})).default;
           const valid = configuration.host === '127.0.0.1'
             && configuration.port === 5432
             && configuration.dbName === 'cli_config_test'
             && configuration.user === 'cli_config_test'
             && configuration.password === 'local_test_only';
           if (!valid) process.exit(1);
           process.stdout.write('CONFIG_LOADED');`,
        ],
        {
          cwd: fixtureDirectory,
          env: environment,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );

      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(stderr).toBe('');
      expect(exitCode).toBe(0);
      expect(stdout).toBe('CONFIG_LOADED');
    } finally {
      await rm(fixtureDirectory, { recursive: true });
    }
  });
});
