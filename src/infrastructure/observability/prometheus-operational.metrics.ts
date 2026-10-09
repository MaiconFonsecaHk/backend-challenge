import { Counter, Gauge, Histogram, Registry } from 'prom-client';

import type {
  OperationalMetrics,
  ReadinessMetricComponent,
  RetryMetricComponent,
  WagerOutcomeMetric,
} from '../../application/ports/operational-metrics.js';

const PREFIX = 'backend_challenge_';

export class PrometheusOperationalMetrics implements OperationalMetrics {
  private readonly registry = new Registry();

  private readonly wagerTransactions = new Counter({
    name: `${PREFIX}wager_transactions_total`,
    help: 'Wager processing outcomes grouped by bounded business dimensions.',
    labelNames: ['source', 'operation', 'status'] as const,
    registers: [this.registry],
  });

  private readonly duplicates = new Counter({
    name: `${PREFIX}wager_duplicates_total`,
    help: 'Idempotent wager replays detected after persistent lookup.',
    labelNames: ['source'] as const,
    registers: [this.registry],
  });

  private readonly retries = new Counter({
    name: `${PREFIX}retries_total`,
    help: 'Retries scheduled by each bounded asynchronous component.',
    labelNames: ['component'] as const,
    registers: [this.registry],
  });

  private readonly deadLetterMessages = new Counter({
    name: `${PREFIX}dead_letter_messages_total`,
    help: 'Wager messages successfully transferred to the dead-letter queue.',
    registers: [this.registry],
  });

  private readonly lockConflicts = new Counter({
    name: `${PREFIX}lock_conflicts_total`,
    help: 'Database deadlock or lock-wait timeout failures while processing wagers.',
    labelNames: ['operation'] as const,
    registers: [this.registry],
  });

  private readonly outboxPendingMessages = new Gauge({
    name: `${PREFIX}outbox_pending_messages`,
    help: 'Current number of unpublished transactional outbox messages.',
    registers: [this.registry],
  });

  private readonly outboxLag = new Gauge({
    name: `${PREFIX}outbox_lag_seconds`,
    help: 'Age in seconds of the oldest unpublished transactional outbox message.',
    registers: [this.registry],
  });

  private readonly processingDuration = new Histogram({
    name: `${PREFIX}wager_processing_duration_seconds`,
    help: 'End-to-end application processing duration for wager submissions.',
    labelNames: ['source', 'operation', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  private readonly reconciliationDivergences = new Counter({
    name: `${PREFIX}reconciliation_divergences_total`,
    help: 'Wallet reconciliation checks that found a ledger divergence.',
    registers: [this.registry],
  });

  private readonly readiness = new Gauge({
    name: `${PREFIX}readiness`,
    help: 'Last observed readiness of each required external component.',
    labelNames: ['component'] as const,
    registers: [this.registry],
  });

  private readonly collectionFailures = new Counter({
    name: `${PREFIX}metrics_collection_failures_total`,
    help: 'Failures while refreshing metrics backed by external state.',
    labelNames: ['collector'] as const,
    registers: [this.registry],
  });

  recordWagerOutcome(outcome: WagerOutcomeMetric): void {
    const labels = {
      source: outcome.source,
      operation: outcome.operation,
      status: outcome.status,
    };
    this.processingDuration.observe(labels, outcome.durationSeconds);
    if (outcome.idempotentReplay) {
      this.duplicates.inc({ source: outcome.source });
    } else {
      this.wagerTransactions.inc(labels);
    }
  }

  recordRetry(component: RetryMetricComponent): void {
    this.retries.inc({ component });
  }

  recordDeadLetterMessage(): void {
    this.deadLetterMessages.inc();
  }

  recordLockConflict(operation: string): void {
    this.lockConflicts.inc({ operation });
  }

  recordReconciliationDivergence(): void {
    this.reconciliationDivergences.inc();
  }

  setOutboxState(pendingMessages: number, lagSeconds: number): void {
    this.outboxPendingMessages.set(pendingMessages);
    this.outboxLag.set(lagSeconds);
  }

  setReadiness(component: ReadinessMetricComponent, ready: boolean): void {
    this.readiness.set({ component }, ready ? 1 : 0);
  }

  recordCollectionFailure(collector: 'outbox'): void {
    this.collectionFailures.inc({ collector });
  }

  contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
