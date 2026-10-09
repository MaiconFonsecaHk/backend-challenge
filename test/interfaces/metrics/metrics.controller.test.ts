import { describe, expect, mock, test } from 'bun:test';

import type { OperationalMetrics } from '../../../src/application/ports/operational-metrics.js';
import type { PersistenceRepositories } from '../../../src/application/ports/persistence/repositories.js';
import type { UnitOfWork } from '../../../src/application/ports/persistence/unit-of-work.js';
import { SystemClock } from '../../../src/infrastructure/time/system-clock.js';
import { MetricsController } from '../../../src/interfaces/metrics/metrics.controller.js';

describe('MetricsController', () => {
  test('refreshes pending outbox count and lag before rendering', async () => {
    const setOutboxState = mock(() => undefined);
    const metrics = metricsDouble({ setOutboxState });
    const now = Date.now();
    const unitOfWork = unitOfWorkDouble({
      pendingMessages: 3,
      oldestPendingAt: new Date(now - 12_500),
    });
    const clock = { now: () => new Date(now) } as SystemClock;
    const response = { setHeader: mock(() => undefined) };
    const controller = new MetricsController(metrics, unitOfWork, clock);

    expect(await controller.get(response)).toBe('metrics-body');
    expect(setOutboxState).toHaveBeenCalledWith(3, 12.5);
    expect(response.setHeader).toHaveBeenCalledWith(
      'content-type',
      'text/plain; version=0.0.4',
    );
  });

  test('keeps exposition available when the outbox snapshot fails', async () => {
    const recordCollectionFailure = mock(() => undefined);
    const metrics = metricsDouble({ recordCollectionFailure });
    const unitOfWork = {
      execute: async () => {
        throw new Error('PostgreSQL unavailable');
      },
    } as UnitOfWork;
    const controller = new MetricsController(
      metrics,
      unitOfWork,
      new SystemClock(),
    );

    expect(
      await controller.get({ setHeader: () => undefined }),
    ).toBe('metrics-body');
    expect(recordCollectionFailure).toHaveBeenCalledWith('outbox');
  });
});

function unitOfWorkDouble(snapshot: {
  readonly pendingMessages: number;
  readonly oldestPendingAt?: Date;
}): UnitOfWork {
  return {
    execute: async (work) =>
      work({
        outboxMessages: {
          getPendingSnapshot: async () => snapshot,
        },
      } as unknown as PersistenceRepositories),
  };
}

function metricsDouble(overrides: Partial<OperationalMetrics>): OperationalMetrics {
  return {
    recordWagerOutcome: overrides.recordWagerOutcome ?? (() => undefined),
    recordRetry: overrides.recordRetry ?? (() => undefined),
    recordDeadLetterMessage:
      overrides.recordDeadLetterMessage ?? (() => undefined),
    recordLockConflict: overrides.recordLockConflict ?? (() => undefined),
    recordReconciliationDivergence:
      overrides.recordReconciliationDivergence ?? (() => undefined),
    setOutboxState: overrides.setOutboxState ?? (() => undefined),
    setReadiness: overrides.setReadiness ?? (() => undefined),
    recordCollectionFailure:
      overrides.recordCollectionFailure ?? (() => undefined),
    contentType: () => 'text/plain; version=0.0.4',
    render: async () => 'metrics-body',
  };
}
