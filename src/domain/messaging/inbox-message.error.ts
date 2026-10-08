import { DomainError } from '../shared/errors/domain.error.js';

export class InvalidInboxIdentityError extends DomainError {
  readonly code = 'INVALID_INBOX_IDENTITY';

  constructor(field: 'messageId' | 'consumerName' | 'payloadHash') {
    super(`Inbox message ${field} must be a non-empty string.`);
  }
}

export class InvalidInboxTimestampError extends DomainError {
  readonly code = 'INVALID_INBOX_TIMESTAMP';

  constructor() {
    super('Inbox message timestamps must be valid Date values.');
  }
}

export class InboxAlreadyProcessedError extends DomainError {
  readonly code = 'INBOX_ALREADY_PROCESSED';

  constructor() {
    super('An inbox message cannot be marked as processed more than once.');
  }
}
