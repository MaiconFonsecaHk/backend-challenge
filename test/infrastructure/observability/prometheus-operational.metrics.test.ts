import { describe, expect, test } from 'bun:test';

import { PrometheusOperationalMetrics } from '../../../src/infrastructure/observability/prometheus-operational.metrics.js';

describe('PrometheusOperationalMetrics', () => {
  test('exports every mandatory signal with bounded labels', async () => {
    const metrics = new PrometheusOperationalMetrics();

    metrics.recordWagerOutcome({
      source: 'sqs',
      operation: 'BET',
      status: 'PROCESSED',
      idempotentReplay: false,
      durationSeconds: 0.125,
    });
    metrics.recordWagerOutcome({
      source: 'sqs',
      operation: 'BET',
      status: 'PROCESSED',
      idempotentReplay: true,
      durationSeconds: 0.25,
    });
    metrics.recordRetry('sqs_wager_consumer');
    metrics.recordRetry('outbox_publisher');
    metrics.recordRetry('pending_reference_worker');
    metrics.recordDeadLetterMessage();
    metrics.recordLockConflict('BET');
    metrics.recordReconciliationDivergence();
    metrics.setOutboxState(7, 42.5);
    metrics.setReadiness('postgresql', true);
    metrics.setReadiness('sqs', false);
    metrics.recordCollectionFailure('outbox');

    const exposition = await metrics.render();

    expect(metrics.contentType()).toContain('text/plain');
    expect(exposition).toContain(
      'backend_challenge_wager_transactions_total{source="sqs",operation="BET",status="PROCESSED"} 1',
    );
    expect(exposition).toContain(
      'backend_challenge_wager_duplicates_total{source="sqs"} 1',
    );
    expect(exposition).toContain(
      'backend_challenge_retries_total{component="sqs_wager_consumer"} 1',
    );
    expect(exposition).toContain('backend_challenge_dead_letter_messages_total 1');
    expect(exposition).toContain(
      'backend_challenge_lock_conflicts_total{operation="BET"} 1',
    );
    expect(exposition).toContain('backend_challenge_outbox_pending_messages 7');
    expect(exposition).toContain('backend_challenge_outbox_lag_seconds 42.5');
    expect(exposition).toContain(
      'backend_challenge_wager_processing_duration_seconds_sum{source="sqs",operation="BET",status="PROCESSED"} 0.375',
    );
    expect(exposition).toContain(
      'backend_challenge_reconciliation_divergences_total 1',
    );
    expect(exposition).toContain(
      'backend_challenge_readiness{component="postgresql"} 1',
    );
    expect(exposition).toContain(
      'backend_challenge_readiness{component="sqs"} 0',
    );
    expect(exposition).toContain(
      'backend_challenge_metrics_collection_failures_total{collector="outbox"} 1',
    );
    expect(exposition).not.toMatch(/walletId|transactionId|providerId|messageId/);
  });

  test('does not count an ordinary wager result as a duplicate', async () => {
    const metrics = new PrometheusOperationalMetrics();

    metrics.recordWagerOutcome({
      source: 'http',
      operation: 'WIN',
      status: 'PROCESSED',
      idempotentReplay: false,
      durationSeconds: 0.01,
    });

    expect(await metrics.render()).not.toContain(
      'backend_challenge_wager_duplicates_total{',
    );
  });
});
