import type { OutboxRetryPolicy } from '../../domain/messaging/outbox-message.js';

export class ExponentialOutboxRetryPolicy implements OutboxRetryPolicy {
  constructor(
    private readonly baseDelaySeconds: number,
    private readonly maximumDelaySeconds: number,
  ) {
    if (
      !Number.isSafeInteger(baseDelaySeconds) ||
      baseDelaySeconds < 1 ||
      !Number.isSafeInteger(maximumDelaySeconds) ||
      maximumDelaySeconds < baseDelaySeconds
    ) {
      throw new Error('Invalid outbox retry delay configuration.');
    }
  }

  nextAttemptAt(attempt: number, failedAt: Date): Date {
    const exponent = Math.max(0, attempt - 1);
    const delaySeconds = Math.min(
      this.baseDelaySeconds * 2 ** exponent,
      this.maximumDelaySeconds,
    );

    return new Date(failedAt.getTime() + delaySeconds * 1_000);
  }
}
