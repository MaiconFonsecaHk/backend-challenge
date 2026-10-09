import { DomainError } from '../errors/domain.error.js';

export class InvalidJsonPayloadError extends DomainError {
  readonly code = 'INVALID_JSON_PAYLOAD';

  constructor() {
    super('Integration payloads must contain only finite JSON values and plain objects.');
  }
}
