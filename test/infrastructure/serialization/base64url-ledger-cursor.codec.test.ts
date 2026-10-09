import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';

import { InvalidLedgerCursorError } from '../../../src/application/errors/wallet-application.error.js';
import { Base64UrlLedgerCursorCodec } from '../../../src/infrastructure/serialization/base64url-ledger-cursor.codec.js';

const POSITION = {
  createdAt: new Date('2026-10-08T16:00:00.123Z'),
  id: '40000000-0000-4000-8000-000000000301',
} as const;

function encoded(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

describe('Base64UrlLedgerCursorCodec', () => {
  test('round trips a deterministic versioned position without exposing plain fields', () => {
    const codec = new Base64UrlLedgerCursorCodec();
    const cursor = codec.encode(POSITION);

    expect(cursor).not.toContain(POSITION.id);
    expect(cursor).not.toContain(POSITION.createdAt.toISOString());
    expect(codec.decode(cursor)).toEqual(POSITION);
    expect(codec.encode(codec.decode(cursor))).toBe(cursor);
  });

  test.each([
    '',
    'not+base64url',
    `${encoded({ version: 1, createdAt: POSITION.createdAt.toISOString(), id: POSITION.id })}=`,
    encoded({ version: 2, createdAt: POSITION.createdAt.toISOString(), id: POSITION.id }),
    encoded({ version: 1, createdAt: 'invalid', id: POSITION.id }),
    encoded({ version: 1, createdAt: POSITION.createdAt.toISOString(), id: '' }),
    encoded({
      version: 1,
      createdAt: POSITION.createdAt.toISOString(),
      id: POSITION.id,
      unexpected: true,
    }),
  ])('rejects malformed or unsupported cursor %p', (cursor) => {
    expect(() => new Base64UrlLedgerCursorCodec().decode(cursor)).toThrow(
      InvalidLedgerCursorError,
    );
  });
});
