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
  INTEGRATION_EVENTS_QUEUE_NAME: 'integration-events.fifo',
  PENDING_REFERENCE_TTL_SECONDS: '86400',
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
    OUTBOX_BATCH_SIZE: 10,
    OUTBOX_POLL_INTERVAL_MS: 1_000,
    OUTBOX_RETRY_BASE_SECONDS: 5,
    OUTBOX_RETRY_MAX_SECONDS: 300,
    PENDING_REFERENCE_BATCH_SIZE: 10,
    PENDING_REFERENCE_POLL_INTERVAL_MS: 1_000,
    PENDING_REFERENCE_RETRY_BASE_SECONDS: 30,
    PENDING_REFERENCE_RETRY_MAX_SECONDS: 3_600,
    PENDING_REFERENCE_TTL_SECONDS: 86_400,
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

test('rejects an outbox retry cap below its base delay', () => {
  const result = environmentSchema.safeParse({
    ...validEnvironment,
    OUTBOX_RETRY_BASE_SECONDS: '30',
    OUTBOX_RETRY_MAX_SECONDS: '10',
  });

  expect(result.success).toBeFalse();
});

test('requires an explicit pending-reference TTL', () => {
  const { PENDING_REFERENCE_TTL_SECONDS: _, ...withoutTtl } = validEnvironment;

  expect(environmentSchema.safeParse(withoutTtl).success).toBeFalse();
});

test('rejects pending-reference delays above their cap or TTL', () => {
  expect(
    environmentSchema.safeParse({
      ...validEnvironment,
      PENDING_REFERENCE_RETRY_BASE_SECONDS: '60',
      PENDING_REFERENCE_RETRY_MAX_SECONDS: '30',
    }).success,
  ).toBeFalse();
  expect(
    environmentSchema.safeParse({
      ...validEnvironment,
      PENDING_REFERENCE_RETRY_MAX_SECONDS: '90000',
    }).success,
  ).toBeFalse();
});
