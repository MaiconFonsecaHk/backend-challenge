export class InvalidSqsWagerMessageError extends Error {
  readonly code = 'INVALID_SQS_WAGER_MESSAGE';

  constructor() {
    super('The SQS message does not match the wagering contract.');
    this.name = 'InvalidSqsWagerMessageError';
  }
}

export class InvalidSqsMessageGroupError extends Error {
  readonly code = 'INVALID_SQS_MESSAGE_GROUP';

  constructor() {
    super('The SQS message group must match the target wallet.');
    this.name = 'InvalidSqsMessageGroupError';
  }
}
