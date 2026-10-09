export type WagerMetricSource = 'http' | 'sqs' | 'pending_reference_worker';
export type RetryMetricComponent =
  | 'sqs_wager_consumer'
  | 'outbox_publisher'
  | 'pending_reference_worker';
export type ReadinessMetricComponent = 'postgresql' | 'sqs';

export interface WagerOutcomeMetric {
  readonly source: WagerMetricSource;
  readonly operation: string;
  readonly status: string;
  readonly idempotentReplay: boolean;
  readonly durationSeconds: number;
}

export interface OperationalMetrics {
  recordWagerOutcome(outcome: WagerOutcomeMetric): void;
  recordRetry(component: RetryMetricComponent): void;
  recordDeadLetterMessage(): void;
  recordLockConflict(operation: string): void;
  recordReconciliationDivergence(): void;
  setOutboxState(pendingMessages: number, lagSeconds: number): void;
  setReadiness(component: ReadinessMetricComponent, ready: boolean): void;
  recordCollectionFailure(collector: 'outbox'): void;
  contentType(): string;
  render(): Promise<string>;
}

export const OPERATIONAL_METRICS = Symbol('OPERATIONAL_METRICS');

export const NOOP_OPERATIONAL_METRICS: OperationalMetrics = Object.freeze({
  recordWagerOutcome: () => undefined,
  recordRetry: () => undefined,
  recordDeadLetterMessage: () => undefined,
  recordLockConflict: () => undefined,
  recordReconciliationDivergence: () => undefined,
  setOutboxState: () => undefined,
  setReadiness: () => undefined,
  recordCollectionFailure: () => undefined,
  contentType: () => 'text/plain',
  render: async () => '',
});
