import { DomainError } from '../shared/errors/domain.error.js';

export class InvalidIntegrationEventIdentityError extends DomainError {
  readonly code = 'INVALID_INTEGRATION_EVENT_IDENTITY';

  constructor(field: 'eventId' | 'aggregateId' | 'correlationId' | 'causationId') {
    super(`Integration event ${field} must be a non-empty string.`);
  }
}

export class InvalidIntegrationEventTimestampError extends DomainError {
  readonly code = 'INVALID_INTEGRATION_EVENT_TIMESTAMP';

  constructor() {
    super('Integration event timestamps must be valid Date values.');
  }
}

export class InvalidIntegrationEventSourceError extends DomainError {
  readonly code = 'INVALID_INTEGRATION_EVENT_SOURCE';

  constructor(reason: string) {
    super(`Cannot create integration event: ${reason}.`);
  }
}
