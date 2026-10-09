import { expect, test } from 'bun:test';

import { environmentSchema } from '../../src/config/environment.schema.js';

const validEnvironment = {
  AWS_REGION: 'us-east-1',
  POSTGRES_DB: 'backend_challenge',
  POSTGRES_HOST: ' 127.0.0.1 ',
  POSTGRES_PASSWORD: 'backend_challenge_local',
  POSTGRES_PORT: '5432',
  POSTGRES_USER: 'backend_challenge',
  SQS_ENDPOINT: 'http://127.0.0.1:4566',
  WAGER_TRANSACTIONS_DLQ_NAME: 'wager-transactions-dlq.fifo',
  WAGER_TRANSACTIONS_QUEUE_NAME: 'wager-transactions.fifo',
} as const;

test('parses and normalizes a valid application environment', () => {
  const environment = environmentSchema.parse(validEnvironment);

  expect(environment).toMatchObject({
    NODE_ENV: 'development',
    PORT: 3_000,
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: 5_432,
    SQS_MAX_RECEIVE_COUNT: 5,
    SQS_VISIBILITY_TIMEOUT_SECONDS: 30,
    SQS_MAX_RETRY_VISIBILITY_SECONDS: 300,
  });
});

test('rejects incomplete static AWS credentials', () => {
  const result = environmentSchema.safeParse({
    ...validEnvironment,
    AWS_ACCESS_KEY_ID: 'test',
  });

  expect(result.success).toBeFalse();
});

test('rejects a retry visibility cap below the base visibility timeout', () => {
  const result = environmentSchema.safeParse({
    ...validEnvironment,
    SQS_VISIBILITY_TIMEOUT_SECONDS: '30',
    SQS_MAX_RETRY_VISIBILITY_SECONDS: '10',
  });

  expect(result.success).toBeFalse();
});
