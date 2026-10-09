import { describe, expect, mock, test } from 'bun:test';
import type { HealthCheckService } from '@nestjs/terminus';

import { HealthController } from '../../../src/interfaces/health/health.controller.js';
import type { PostgresqlHealthIndicator } from '../../../src/interfaces/health/postgresql.health-indicator.js';
import type { SqsHealthIndicator } from '../../../src/interfaces/health/sqs.health-indicator.js';

describe('health controller responsibilities', () => {
  test('keeps liveness independent from external dependencies', async () => {
    const check = mock(async (indicators: readonly unknown[]) => ({
      status: 'ok' as const,
      info: {},
      error: {},
      details: {},
      indicatorCount: indicators.length,
    }));
    const controller = healthController(check);

    const result = await controller.liveness();

    expect(check).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ok', indicatorCount: 0 });
  });

  test('requires both PostgreSQL and SQS for readiness', async () => {
    const databaseCheck = mock(async () => ({ postgresql: { status: 'up' } }));
    const sqsCheck = mock(async () => ({ sqs: { status: 'up' } }));
    const check = mock(async (indicators: readonly (() => Promise<unknown>)[]) => {
      const results = await Promise.all(indicators.map((indicator) => indicator()));
      return {
        status: 'ok' as const,
        info: {},
        error: {},
        details: {},
        results,
      };
    });
    const controller = healthController(check, databaseCheck, sqsCheck);

    const result = await controller.readiness();

    expect(databaseCheck).toHaveBeenCalledTimes(1);
    expect(sqsCheck).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ok' });
  });
});

function healthController(
  check: ReturnType<typeof mock>,
  databaseCheck: ReturnType<typeof mock> = mock(async () => undefined),
  sqsCheck: ReturnType<typeof mock> = mock(async () => undefined),
): HealthController {
  return new HealthController(
    { check } as unknown as HealthCheckService,
    { check: databaseCheck } as unknown as PostgresqlHealthIndicator,
    { check: sqsCheck } as unknown as SqsHealthIndicator,
  );
}
