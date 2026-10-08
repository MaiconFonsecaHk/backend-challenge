import { IntegrationEvent } from '../events/integration-event.js';
import { cloneAndFreezeJson } from '../shared/serialization/immutable-json.js';
import {
  InvalidOutboxRetryScheduleError,
  InvalidOutboxTimestampError,
  OutboxAlreadyPublishedError,
} from './outbox-message.error.js';

export interface OutboxRetryPolicy {
  nextAttemptAt(attempt: number, failedAt: Date): Date;
}

export interface OutboxMessageState {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly attempts: number;
  readonly nextAttemptAt?: Date;
  readonly publishedAt?: Date;
}

export class OutboxMessage {
  readonly payload: Readonly<Record<string, unknown>>;

  private readonly _occurredAt: Date;
  private _attempts: number;
  private _nextAttemptAt?: Date;
  private _publishedAt?: Date;

  private constructor(
    public readonly id: string,
    public readonly aggregateId: string,
    public readonly eventType: string,
    payload: Readonly<Record<string, unknown>>,
    occurredAt: Date,
    attempts: number,
    nextAttemptAt?: Date,
    publishedAt?: Date,
  ) {
    this.payload = cloneAndFreezeJson(payload);
    this._occurredAt = OutboxMessage.copyDate(occurredAt);
    this._attempts = attempts;
    this._nextAttemptAt = OutboxMessage.copyOptionalDate(nextAttemptAt);
    this._publishedAt = OutboxMessage.copyOptionalDate(publishedAt);
  }

  static enqueue<T extends object>(event: IntegrationEvent<T>): OutboxMessage {
    const payload = event.toJSON();

    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      payload,
      event.occurredAt,
      0,
    );
  }

  static rehydrate(state: OutboxMessageState): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      state.payload,
      state.occurredAt,
      state.attempts,
      state.nextAttemptAt,
      state.publishedAt,
    );
  }

  get occurredAt(): Date {
    return OutboxMessage.copyDate(this._occurredAt);
  }

  get attempts(): number {
    return this._attempts;
  }

  get nextAttemptAt(): Date | undefined {
    return OutboxMessage.copyOptionalDate(this._nextAttemptAt);
  }

  get publishedAt(): Date | undefined {
    return OutboxMessage.copyOptionalDate(this._publishedAt);
  }

  isPending(): boolean {
    return this._publishedAt === undefined;
  }

  isDue(now: Date): boolean {
    OutboxMessage.assertValidTimestamp(now);

    return (
      this.isPending() &&
      (this._nextAttemptAt === undefined || this._nextAttemptAt.getTime() <= now.getTime())
    );
  }

  markPublished(at: Date): void {
    this.assertPending();
    OutboxMessage.assertValidTimestamp(at);

    this._publishedAt = OutboxMessage.copyDate(at);
    this._nextAttemptAt = undefined;
  }

  scheduleRetry(failedAt: Date, policy: OutboxRetryPolicy): void {
    this.assertPending();
    OutboxMessage.assertValidTimestamp(failedAt);

    const nextAttempt = this._attempts + 1;
    const nextAttemptAt = policy.nextAttemptAt(nextAttempt, OutboxMessage.copyDate(failedAt));

    OutboxMessage.assertValidTimestamp(nextAttemptAt);

    if (nextAttemptAt.getTime() < failedAt.getTime()) {
      throw new InvalidOutboxRetryScheduleError();
    }

    this._attempts = nextAttempt;
    this._nextAttemptAt = OutboxMessage.copyDate(nextAttemptAt);
  }

  private static assertValidTimestamp(value: Date): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidOutboxTimestampError();
    }
  }

  private static copyDate(value: Date): Date {
    return new Date(value.getTime());
  }

  private static copyOptionalDate(value: Date | undefined): Date | undefined {
    return value === undefined ? undefined : OutboxMessage.copyDate(value);
  }

  private assertPending(): void {
    if (!this.isPending()) {
      throw new OutboxAlreadyPublishedError();
    }
  }
}
