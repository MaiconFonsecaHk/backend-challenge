import { describe, expect, mock, test } from 'bun:test';
import type { ConfigService } from '@nestjs/config';

import type { ProcessPendingReferencesBatchUseCase } from '../../../src/application/use-cases/wagering/process-pending-references-batch.use-case.js';
import type { EnvironmentVariables } from '../../../src/config/environment.schema.js';
import { PendingReferenceWorker } from '../../../src/interfaces/workers/pending-reference.worker.js';

describe('PendingReferenceWorker', () => {
  test('drains an in-flight claim before completing shutdown', async () => {
    const started = promiseWithResolvers<void>();
    const complete = promiseWithResolvers<void>();
    const execute = mock(async () => {
      started.resolve();
      await complete.promise;
      return { claimed: 1, processed: 1, rejected: 0, rescheduled: 0 };
    });
    const worker = new PendingReferenceWorker(
      { execute } as unknown as ProcessPendingReferencesBatchUseCase,
      config(),
    );

    worker.onApplicationBootstrap();
    await started.promise;
    let stopped = false;
    const shutdown = worker.onApplicationShutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBeFalse();

    complete.resolve();
    await shutdown;

    expect(stopped).toBeTrue();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(10);
  });

  test('wakes an idle polling delay immediately during shutdown', async () => {
    const executed = promiseWithResolvers<void>();
    const execute = mock(async () => {
      executed.resolve();
      return { claimed: 0, processed: 0, rejected: 0, rescheduled: 0 };
    });
    const worker = new PendingReferenceWorker(
      { execute } as unknown as ProcessPendingReferencesBatchUseCase,
      config(),
    );

    worker.onApplicationBootstrap();
    await executed.promise;
    await worker.onApplicationShutdown();

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

function config(): ConfigService<EnvironmentVariables, true> {
  const values: Partial<EnvironmentVariables> = {
    PENDING_REFERENCE_BATCH_SIZE: 10,
    PENDING_REFERENCE_POLL_INTERVAL_MS: 60_000,
  };
  return {
    get: (key: keyof EnvironmentVariables) => values[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

function promiseWithResolvers<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
