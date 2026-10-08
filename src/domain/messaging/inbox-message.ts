import {
  InboxAlreadyProcessedError,
  InvalidInboxIdentityError,
  InvalidInboxTimestampError,
} from './inbox-message.error.js';

export interface ReceiveInboxMessageProps {
  readonly messageId: string;
  readonly consumerName: string;
  readonly payloadHash: string;
  readonly receivedAt: Date;
}

export interface InboxMessageState extends ReceiveInboxMessageProps {
  readonly processedAt?: Date;
}

export class InboxMessage {
  private readonly _receivedAt: Date;
  private _processedAt?: Date;

  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    receivedAt: Date,
    processedAt?: Date,
  ) {
    this._receivedAt = InboxMessage.copyDate(receivedAt);
    this._processedAt = InboxMessage.copyOptionalDate(processedAt);
  }

  static receive(props: ReceiveInboxMessageProps): InboxMessage {
    InboxMessage.assertIdentity(props.messageId, 'messageId');
    InboxMessage.assertIdentity(props.consumerName, 'consumerName');
    InboxMessage.assertIdentity(props.payloadHash, 'payloadHash');
    InboxMessage.assertValidTimestamp(props.receivedAt);

    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt,
    );
  }

  get receivedAt(): Date {
    return InboxMessage.copyDate(this._receivedAt);
  }

  get processedAt(): Date | undefined {
    return InboxMessage.copyOptionalDate(this._processedAt);
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InboxAlreadyProcessedError();
    }

    InboxMessage.assertValidTimestamp(at);
    this._processedAt = InboxMessage.copyDate(at);
  }

  private static assertIdentity(
    value: string,
    field: 'messageId' | 'consumerName' | 'payloadHash',
  ): void {
    if (value.trim().length === 0) {
      throw new InvalidInboxIdentityError(field);
    }
  }

  private static assertValidTimestamp(value: Date): void {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new InvalidInboxTimestampError();
    }
  }

  private static copyDate(value: Date): Date {
    return new Date(value.getTime());
  }

  private static copyOptionalDate(value: Date | undefined): Date | undefined {
    return value === undefined ? undefined : InboxMessage.copyDate(value);
  }
}
