export interface PendingReferenceRetrySchedule {
  readonly attempts: number;
  readonly nextAttemptAt: Date;
}

export class PendingReferenceRetryPolicy {
  constructor(
    private readonly baseDelaySeconds: number,
    private readonly maximumDelaySeconds: number,
    private readonly timeToLiveSeconds: number,
  ) {
    if (
      !Number.isSafeInteger(baseDelaySeconds) ||
      baseDelaySeconds < 1 ||
      !Number.isSafeInteger(maximumDelaySeconds) ||
      maximumDelaySeconds < baseDelaySeconds ||
      !Number.isSafeInteger(timeToLiveSeconds) ||
      timeToLiveSeconds < maximumDelaySeconds
    ) {
      throw new Error('Invalid pending-reference retry configuration.');
    }
  }

  nextRetry(
    currentAttempts: number,
    createdAt: Date,
    attemptedAt: Date,
  ): PendingReferenceRetrySchedule | undefined {
    if (
      !Number.isSafeInteger(currentAttempts) ||
      currentAttempts < 0 ||
      currentAttempts >= Number.MAX_SAFE_INTEGER
    ) {
      throw new Error('Pending-reference attempts must be a non-negative safe integer.');
    }
    if (
      !(createdAt instanceof Date) ||
      !(attemptedAt instanceof Date) ||
      Number.isNaN(createdAt.getTime()) ||
      Number.isNaN(attemptedAt.getTime()) ||
      attemptedAt.getTime() < createdAt.getTime()
    ) {
      throw new Error('Invalid pending-reference retry timestamps.');
    }

    const expiresAt = new Date(
      createdAt.getTime() + this.timeToLiveSeconds * 1_000,
    );
    if (attemptedAt.getTime() >= expiresAt.getTime()) {
      return undefined;
    }

    const attempts = currentAttempts + 1;
    const exponent = Math.max(0, attempts - 1);
    const delaySeconds = Math.min(
      this.baseDelaySeconds * 2 ** exponent,
      this.maximumDelaySeconds,
    );
    const scheduledAt = new Date(attemptedAt.getTime() + delaySeconds * 1_000);

    return Object.freeze({
      attempts,
      nextAttemptAt:
        scheduledAt.getTime() < expiresAt.getTime() ? scheduledAt : expiresAt,
    });
  }
}
