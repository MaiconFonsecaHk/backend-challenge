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

export class WalletNotFoundError extends ApplicationError {
  readonly code = 'WALLET_NOT_FOUND';

  constructor(public readonly walletId: string) {
    super(`Wallet ${walletId} was not found.`);
  }
}

export class InvalidLedgerPageLimitError extends ApplicationError {
  readonly code = 'INVALID_LEDGER_PAGE_LIMIT';

  constructor() {
    super('Ledger page limit must be a positive integer.');
  }
}

export class InvalidLedgerCursorError extends ApplicationError {
  readonly code = 'INVALID_LEDGER_CURSOR';

  constructor(options?: ErrorOptions) {
    super('Ledger cursor is invalid or unsupported.', options);
  }
}
