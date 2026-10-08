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
