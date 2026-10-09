import { describe, expect, test } from 'bun:test';

import {
  InboxAlreadyProcessedError,
  InvalidInboxIdentityError,
  InvalidInboxTimestampError,
} from '../../../src/domain/messaging/inbox-message.error.js';
import { InboxMessage } from '../../../src/domain/messaging/inbox-message.js';

const RECEIVED_AT = new Date('2026-10-07T15:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-07T15:01:00.000Z');

function receiveMessage(): InboxMessage {
  return InboxMessage.receive({
    messageId: 'message-id',
    consumerName: 'wager-transactions-consumer',
    payloadHash: 'payload-hash',
    receivedAt: RECEIVED_AT,
  });
}

describe('InboxMessage', () => {
  test('receives a new unprocessed message with its persistent deduplication identity', () => {
    const message = receiveMessage();

    expect(message.messageId).toBe('message-id');
    expect(message.consumerName).toBe('wager-transactions-consumer');
    expect(message.payloadHash).toBe('payload-hash');
    expect(message.receivedAt).toEqual(RECEIVED_AT);
    expect(message.processedAt).toBeUndefined();
    expect(message.isProcessed()).toBe(false);
  });

  test('distinguishes an identical replay from a payload conflict', () => {
    const message = receiveMessage();

    expect(message.matchesPayload('payload-hash')).toBe(true);
    expect(message.matchesPayload('different-payload-hash')).toBe(false);
  });

  test('marks a message as processed exactly once', () => {
    const message = receiveMessage();

    message.markProcessed(PROCESSED_AT);

    expect(message.isProcessed()).toBe(true);
    expect(message.processedAt).toEqual(PROCESSED_AT);
    expect(() => message.markProcessed(new Date('2026-10-07T15:02:00.000Z'))).toThrow(
      InboxAlreadyProcessedError,
    );
    expect(message.processedAt).toEqual(PROCESSED_AT);
  });

  test('protects received and processed timestamps from external mutation', () => {
    const receivedAt = new Date(RECEIVED_AT.getTime());
    const processedAt = new Date(PROCESSED_AT.getTime());
    const message = InboxMessage.receive({
      messageId: 'message-id',
      consumerName: 'consumer',
      payloadHash: 'payload-hash',
      receivedAt,
    });

    message.markProcessed(processedAt);
    receivedAt.setUTCFullYear(2030);
    processedAt.setUTCFullYear(2030);
    message.receivedAt.setUTCFullYear(2031);
    message.processedAt?.setUTCFullYear(2031);

    expect(message.receivedAt).toEqual(RECEIVED_AT);
    expect(message.processedAt).toEqual(PROCESSED_AT);
  });

  test.each([
    { messageId: '', consumerName: 'consumer', payloadHash: 'hash' },
    { messageId: 'message-id', consumerName: '   ', payloadHash: 'hash' },
    { messageId: 'message-id', consumerName: 'consumer', payloadHash: '' },
  ])('rejects an empty inbox identity: %o', (identity) => {
    expect(() => InboxMessage.receive({ ...identity, receivedAt: RECEIVED_AT })).toThrow(
      InvalidInboxIdentityError,
    );
  });

  test('rejects invalid timestamps without changing processing state', () => {
    expect(() =>
      InboxMessage.receive({
        messageId: 'message-id',
        consumerName: 'consumer',
        payloadHash: 'hash',
        receivedAt: new Date('invalid'),
      }),
    ).toThrow(InvalidInboxTimestampError);

    const message = receiveMessage();
    expect(() => message.markProcessed(new Date('invalid'))).toThrow(InvalidInboxTimestampError);
    expect(message.isProcessed()).toBe(false);
  });

  test('rehydrates persisted processing state without replaying transitions', () => {
    const receivedAt = new Date(RECEIVED_AT.getTime());
    const processedAt = new Date(PROCESSED_AT.getTime());
    const message = InboxMessage.rehydrate({
      messageId: 'message-id',
      consumerName: 'consumer',
      payloadHash: 'payload-hash',
      receivedAt,
      processedAt,
    });

    receivedAt.setUTCFullYear(2030);
    processedAt.setUTCFullYear(2030);

    expect(message.isProcessed()).toBe(true);
    expect(message.receivedAt).toEqual(RECEIVED_AT);
    expect(message.processedAt).toEqual(PROCESSED_AT);
  });

  test('exposes stable error codes for inbox invariant violations', () => {
    expect(new InvalidInboxIdentityError('messageId').code).toBe('INVALID_INBOX_IDENTITY');
    expect(new InvalidInboxTimestampError().code).toBe('INVALID_INBOX_TIMESTAMP');
    expect(new InboxAlreadyProcessedError().code).toBe('INBOX_ALREADY_PROCESSED');
  });
});
