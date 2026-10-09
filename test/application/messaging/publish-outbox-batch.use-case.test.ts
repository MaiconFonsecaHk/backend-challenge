import { describe, expect, mock, test } from 'bun:test';

import type { Clock } from '../../../src/application/ports/clock.js';
import type { OperationalLogger } from '../../../src/application/ports/operational-logger.js';
import type { OperationalMetrics } from '../../../src/application/ports/operational-metrics.js';
import type {
  OutboxEventPublication,
  OutboxEventTransport,
} from '../../../src/application/ports/outbox-event-transport.js';
import type { PersistenceRepositories } from '../../../src/application/ports/persistence/repositories.js';
import type { UnitOfWork } from '../../../src/application/ports/persistence/unit-of-work.js';
import { ExponentialOutboxRetryPolicy } from '../../../src/application/services/exponential-outbox-retry.policy.js';
import { PublishOutboxBatchUseCase } from '../../../src/application/use-cases/messaging/publish-outbox-batch.use-case.js';
import { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');

describe('PublishOutboxBatchUseCase', () => {
  test('publishes claimed events and persists their successful completion', async () => {
    const first = message('50000000-0000-4000-8000-000000000701');
    const second = message('50000000-0000-4000-8000-000000000702');
    const harness = createHarness([first, second]);

    const result = await harness.useCase.execute(10);

    expect(result).toEqual({ claimed: 2, published: 2, failed: 0 });
    expect(harness.queries).toEqual([{ now: NOW, limit: 10 }]);
    expect(harness.publications.map((event) => event.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(harness.saved).toEqual([first, second]);
    expect(first.publishedAt).toEqual(NOW);
    expect(second.publishedAt).toEqual(NOW);
  });

  test('schedules a bounded retry without preventing later events in the batch', async () => {
    const failed = message('50000000-0000-4000-8000-000000000703');
    const published = message('50000000-0000-4000-8000-000000000704');
    const warn = mock(() => undefined);
    const recordRetry = mock(() => undefined);
    const harness = createHarness(
      [failed, published],
      failed.id,
      operationalLogger({ warn }),
      operationalMetrics({ recordRetry }),
    );

    const result = await harness.useCase.execute(2);

    expect(result).toEqual({ claimed: 2, published: 1, failed: 1 });
    expect(failed.attempts).toBe(1);
    expect(failed.nextAttemptAt).toEqual(
      new Date('2026-10-09T12:00:05.000Z'),
    );
    expect(failed.publishedAt).toBeUndefined();
    expect(published.publishedAt).toEqual(NOW);
    expect(harness.saved).toEqual([failed, published]);
    expect(warn).toHaveBeenCalledWith('outbox.publish.retry_scheduled', {
      eventId: failed.id,
      eventType: 'WalletBalanceChanged',
      operation: 'OUTBOX_PUBLICATION',
      status: 'RETRY_SCHEDULED',
      attempt: 1,
      retryable: true,
    });
    expect(recordRetry).toHaveBeenCalledWith('outbox_publisher');
  });

  test('does no transport or persistence work when no event is due', async () => {
    const harness = createHarness([]);

    expect(await harness.useCase.execute(10)).toEqual({
      claimed: 0,
      published: 0,
      failed: 0,
    });
    expect(harness.publications).toEqual([]);
    expect(harness.saved).toEqual([]);
  });

  test('rejects an invalid batch limit before opening the transaction', async () => {
    const harness = createHarness([]);

    expect(() => harness.useCase.execute(0)).toThrow(
      'Outbox batch limit must be a positive safe integer.',
    );
    expect(harness.unitOfWorkCalls()).toBe(0);
  });
});

function message(id: string): OutboxMessage {
  return OutboxMessage.rehydrate({
    id,
    aggregateId: '10000000-0000-4000-8000-000000000701',
    eventType: 'WalletBalanceChanged',
    payload: {
      eventId: id,
      eventType: 'WalletBalanceChanged',
      aggregateId: '10000000-0000-4000-8000-000000000701',
      occurredAt: NOW.toISOString(),
      version: 1,
      correlationId: 'correlation-701',
      data: { walletId: '10000000-0000-4000-8000-000000000701' },
    },
    occurredAt: NOW,
    attempts: 0,
  });
}

function createHarness(
  messages: readonly OutboxMessage[],
  failingId?: string,
  logger?: OperationalLogger,
  metrics?: OperationalMetrics,
): {
  readonly useCase: PublishOutboxBatchUseCase;
  readonly queries: Array<{ now: Date; limit: number }>;
  readonly publications: OutboxEventPublication[];
  readonly saved: OutboxMessage[];
  unitOfWorkCalls(): number;
} {
  const queries: Array<{ now: Date; limit: number }> = [];
  const publications: OutboxEventPublication[] = [];
  const saved: OutboxMessage[] = [];
  let calls = 0;
  const repositories = {
    outboxMessages: {
      findDueForUpdate: async (now: Date, limit: number) => {
        queries.push({ now, limit });
        return messages;
      },
      save: async (outboxMessage: OutboxMessage) => {
        saved.push(outboxMessage);
      },
    },
  } as unknown as PersistenceRepositories;
  const unitOfWork: UnitOfWork = {
    execute: async (work) => {
      calls += 1;
      return work(repositories);
    },
  };
  const transport: OutboxEventTransport = {
    publish: async (publication) => {
      publications.push(publication);
      if (publication.id === failingId) {
        throw new Error('SQS unavailable');
      }
    },
  };
  const clock: Clock = { now: () => new Date(NOW.getTime()) };

  return {
    useCase: new PublishOutboxBatchUseCase(
      unitOfWork,
      transport,
      clock,
      new ExponentialOutboxRetryPolicy(5, 300),
      logger,
      metrics,
    ),
    queries,
    publications,
    saved,
    unitOfWorkCalls: () => calls,
  };
}

function operationalMetrics(overrides: Partial<OperationalMetrics>): OperationalMetrics {
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
    contentType: () => 'text/plain',
    render: async () => '',
  };
}

function operationalLogger(overrides: Partial<OperationalLogger> = {}): OperationalLogger {
  return {
    info: overrides.info ?? (() => undefined),
    warn: overrides.warn ?? (() => undefined),
    error: overrides.error ?? (() => undefined),
  };
}
