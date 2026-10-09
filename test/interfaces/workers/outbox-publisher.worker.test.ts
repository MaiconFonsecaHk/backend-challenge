import { describe, expect, mock, test } from 'bun:test';
import type { ConfigService } from '@nestjs/config';

import type { PublishOutboxBatchUseCase } from '../../../src/application/use-cases/messaging/publish-outbox-batch.use-case.js';
import type { EnvironmentVariables } from '../../../src/config/environment.schema.js';
import { OutboxPublisherWorker } from '../../../src/interfaces/workers/outbox-publisher.worker.js';

describe('OutboxPublisherWorker', () => {
  test('drains an in-flight database claim before completing shutdown', async () => {
    const started = promiseWithResolvers<void>();
    const complete = promiseWithResolvers<void>();
    const execute = mock(async () => {
      started.resolve();
      await complete.promise;
      return { claimed: 1, published: 1, failed: 0 };
    });
    const worker = new OutboxPublisherWorker(
      { execute } as unknown as PublishOutboxBatchUseCase,
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
      return { claimed: 0, published: 0, failed: 0 };
    });
    const worker = new OutboxPublisherWorker(
      { execute } as unknown as PublishOutboxBatchUseCase,
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
    OUTBOX_BATCH_SIZE: 10,
    OUTBOX_POLL_INTERVAL_MS: 60_000,
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
