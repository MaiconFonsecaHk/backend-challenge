import { ApplicationError } from './application.error.js';

export class InvalidWagerCommandError extends ApplicationError {
  readonly code = 'INVALID_WAGER_COMMAND';

  constructor(reason: string) {
    super(`Wager transaction command is invalid: ${reason}.`);
  }
}

export class ExternalOpeningNotAllowedError extends ApplicationError {
  readonly code = 'EXTERNAL_OPENING_NOT_ALLOWED';

  constructor() {
    super('OPENING transactions are internal and cannot be submitted.');
  }
}

export class IdempotencyConflictError extends ApplicationError {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor(idempotencyKey: string) {
    super(
      `Idempotency key ${idempotencyKey} was already used with a different payload.`,
    );
  }
}

export class ProviderTransactionConflictError extends ApplicationError {
  readonly code = 'PROVIDER_TRANSACTION_CONFLICT';

  constructor(providerId: string, externalTransactionId: string) {
    super(
      `Provider transaction ${providerId}:${externalTransactionId} was already submitted with another idempotency key.`,
    );
  }
}

export class WagerTransactionNotFoundError extends ApplicationError {
  readonly code = 'WAGER_TRANSACTION_NOT_FOUND';

  constructor() {
    super('Wager transaction was not found.');
  }
}

export class InboxPayloadConflictError extends ApplicationError {
  readonly code = 'INBOX_PAYLOAD_CONFLICT';

  constructor() {
    super('The message identity was already used with a different payload.');
  }
}
