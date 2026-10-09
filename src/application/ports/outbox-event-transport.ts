export interface OutboxEventPublication {
  readonly id: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OutboxEventTransport {
  publish(event: OutboxEventPublication): Promise<void>;
}

export const OUTBOX_EVENT_TRANSPORT = Symbol('OUTBOX_EVENT_TRANSPORT');
