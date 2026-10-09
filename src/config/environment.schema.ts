import { z } from 'zod';

const runtimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
});

export const databaseEnvironmentSchema = z.object({
  POSTGRES_HOST: z.string().trim().min(1),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65_535),
  POSTGRES_DB: z.string().trim().min(1),
  POSTGRES_USER: z.string().trim().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
});

const sqsEnvironmentSchema = z.object({
  AWS_REGION: z.string().trim().min(1),
  AWS_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  SQS_ENDPOINT: z.url().optional(),
  WAGER_TRANSACTIONS_QUEUE_NAME: z.string().trim().endsWith('.fifo'),
  WAGER_TRANSACTIONS_DLQ_NAME: z.string().trim().endsWith('.fifo'),
  SQS_MAX_RECEIVE_COUNT: z.coerce.number().int().min(2).default(5),
  SQS_VISIBILITY_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(43_200)
    .default(30),
  SQS_MAX_RETRY_VISIBILITY_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(43_200)
    .default(300),
});

export const environmentSchema = runtimeEnvironmentSchema
  .extend(databaseEnvironmentSchema.shape)
  .extend(sqsEnvironmentSchema.shape)
  .superRefine((environment, context) => {
    const hasAccessKey = environment.AWS_ACCESS_KEY_ID !== undefined;
    const hasSecretKey = environment.AWS_SECRET_ACCESS_KEY !== undefined;

    if (hasAccessKey !== hasSecretKey) {
      context.addIssue({
        code: 'custom',
        message:
          'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be provided together',
        path: ['AWS_ACCESS_KEY_ID'],
      });
    }

    if (
      environment.SQS_MAX_RETRY_VISIBILITY_SECONDS <
      environment.SQS_VISIBILITY_TIMEOUT_SECONDS
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'SQS_MAX_RETRY_VISIBILITY_SECONDS must be greater than or equal to SQS_VISIBILITY_TIMEOUT_SECONDS',
        path: ['SQS_MAX_RETRY_VISIBILITY_SECONDS'],
      });
    }
  });

export type EnvironmentVariables = z.output<typeof environmentSchema>;
