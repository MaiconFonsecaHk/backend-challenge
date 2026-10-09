export interface OperationalLogContext {
  readonly correlationId?: string;
  readonly messageId?: string;
  readonly transactionId?: string;
  readonly walletId?: string;
  readonly providerId?: string;
  readonly eventId?: string;
  readonly eventType?: string;
  readonly operation?: string;
  readonly status?: string;
  readonly failureCode?: string;
  readonly errorType?: string;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly claimed?: number;
  readonly processed?: number;
  readonly rejected?: number;
  readonly rescheduled?: number;
  readonly published?: number;
  readonly failed?: number;
  readonly statusCode?: number;
  readonly retryable?: boolean;
  readonly idempotentReplay?: boolean;
}

export interface OperationalLogger {
  info(event: string, context: OperationalLogContext): void;
  warn(event: string, context: OperationalLogContext): void;
  error(event: string, context: OperationalLogContext): void;
}

export const OPERATIONAL_LOGGER = Symbol('OPERATIONAL_LOGGER');

export const NOOP_OPERATIONAL_LOGGER: OperationalLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});
