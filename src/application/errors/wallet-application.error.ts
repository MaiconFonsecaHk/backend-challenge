import { ApplicationError } from './application.error.js';

export class InvalidCorrelationIdError extends ApplicationError {
  readonly code = 'INVALID_CORRELATION_ID';

  constructor() {
    super('Correlation id must be a non-empty string.');
  }
}

export class WalletAlreadyExistsError extends ApplicationError {
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`A ${currency} wallet already exists for player ${playerId}.`);
  }
}
