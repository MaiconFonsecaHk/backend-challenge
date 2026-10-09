import { DomainError } from '../shared/errors/domain.error.js';

export class InvalidOutboxTimestampError extends DomainError {
  readonly code = 'INVALID_OUTBOX_TIMESTAMP';

  constructor() {
    super('Outbox timestamps must be valid Date values.');
  }
}

export class OutboxAlreadyPublishedError extends DomainError {
  readonly code = 'OUTBOX_ALREADY_PUBLISHED';

  constructor() {
    super('A published outbox message cannot transition again.');
  }
}

export class InvalidOutboxRetryScheduleError extends DomainError {
  readonly code = 'INVALID_OUTBOX_RETRY_SCHEDULE';

  constructor() {
    super('An outbox retry must be scheduled at or after the failed attempt.');
  }
}
