import {
  cloneAndFreezeJson,
  type DeepReadonly,
} from '../shared/serialization/immutable-json.js';
import {
  InvalidIntegrationEventIdentityError,
  InvalidIntegrationEventTimestampError,
} from './integration-event.error.js';

export interface EventContext {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: Date;
}

export interface IntegrationEventProps<T extends object> extends EventContext {
  readonly aggregateId: string;
  readonly data: T;
}

export interface IntegrationEventEnvelope<T extends object> {
  readonly [key: string]: unknown;
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly occurredAt: string;
  readonly version: number;
  readonly data: DeepReadonly<T>;
}

export abstract class IntegrationEvent<T extends object> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId: string | undefined;
  readonly data: DeepReadonly<T>;

  private readonly _occurredAt: Date;

  protected constructor(props: IntegrationEventProps<T>) {
    IntegrationEvent.assertIdentity(props.eventId, 'eventId');
    IntegrationEvent.assertIdentity(props.aggregateId, 'aggregateId');
    IntegrationEvent.assertIdentity(props.correlationId, 'correlationId');

    if (props.causationId !== undefined) {
      IntegrationEvent.assertIdentity(props.causationId, 'causationId');
    }

    IntegrationEvent.assertValidTimestamp(props.occurredAt);

    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this._occurredAt = new Date(props.occurredAt.getTime());
    this.data = cloneAndFreezeJson(props.data);
  }

  get occurredAt(): Date {
    return new Date(this._occurredAt.getTime());
  }

  toJSON(): DeepReadonly<IntegrationEventEnvelope<T>> {
    return cloneAndFreezeJson({
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      ...(this.causationId === undefined ? {} : { causationId: this.causationId }),
      occurredAt: this._occurredAt.toISOString(),
      version: this.version,
      data: this.data,
    });
  }

  private static assertIdentity(
    value: string,
    field: 'eventId' | 'aggregateId' | 'correlationId' | 'causationId',
  ): void {
    if (value.trim().length === 0) {
      throw new InvalidIntegrationEventIdentityError(field);
    }
  }

  private static assertValidTimestamp(value: Date): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidIntegrationEventTimestampError();
    }
  }
}
