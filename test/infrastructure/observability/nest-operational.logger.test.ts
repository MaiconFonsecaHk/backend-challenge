import { describe, expect, mock, test } from 'bun:test';
import type { LoggerService } from '@nestjs/common';

import { NestOperationalLogger } from '../../../src/infrastructure/observability/nest-operational.logger.js';

describe('NestOperationalLogger', () => {
  test('emits structured records through each severity', () => {
    const log = mock((_record: unknown) => undefined);
    const warn = mock((_record: unknown) => undefined);
    const error = mock((_record: unknown) => undefined);
    const logger = new NestOperationalLogger({
      log,
      warn,
      error,
    } satisfies Pick<LoggerService, 'log' | 'warn' | 'error'>);
    const context = {
      correlationId: 'correlation-801',
      transactionId: 'transaction-801',
      operation: 'BET',
      status: 'PROCESSED',
      durationMs: 12.34,
    } as const;

    logger.info('wager.completed', context);
    logger.warn('wager.delayed', context);
    logger.error('wager.failed', context);

    expect(log).toHaveBeenCalledWith({ event: 'wager.completed', ...context });
    expect(warn).toHaveBeenCalledWith({ event: 'wager.delayed', ...context });
    expect(error).toHaveBeenCalledWith({ event: 'wager.failed', ...context });
    expect(Object.keys(log.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'correlationId',
      'durationMs',
      'event',
      'operation',
      'status',
      'transactionId',
    ]);
  });
});
