import { Buffer } from 'node:buffer';

import { InvalidLedgerCursorError } from '../../application/errors/wallet-application.error.js';
import type { LedgerCursorCodec } from '../../application/ports/ledger-cursor-codec.js';
import type { WalletLedgerPagePosition } from '../../application/ports/persistence/repositories.js';

const CURSOR_VERSION = 1;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

interface SerializedLedgerCursor {
  readonly version: number;
  readonly createdAt: string;
  readonly id: string;
}

export class Base64UrlLedgerCursorCodec implements LedgerCursorCodec {
  encode(position: WalletLedgerPagePosition): string {
    const payload: SerializedLedgerCursor = {
      version: CURSOR_VERSION,
      createdAt: position.createdAt.toISOString(),
      id: position.id,
    };

    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  decode(cursor: string): WalletLedgerPagePosition {
    try {
      if (!BASE64URL_PATTERN.test(cursor)) {
        throw new Error('Cursor is not canonical base64url');
      }

      const bytes = Buffer.from(cursor, 'base64url');
      if (bytes.toString('base64url') !== cursor) {
        throw new Error('Cursor has a non-canonical encoding');
      }

      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const payload: unknown = JSON.parse(decoded);
      if (!Base64UrlLedgerCursorCodec.isSupportedPayload(payload)) {
        throw new Error('Cursor payload has an invalid shape');
      }

      const createdAt = new Date(payload.createdAt);
      if (
        Number.isNaN(createdAt.getTime()) ||
        createdAt.toISOString() !== payload.createdAt
      ) {
        throw new Error('Cursor timestamp is invalid');
      }

      return Object.freeze({ createdAt, id: payload.id });
    } catch (error) {
      if (error instanceof InvalidLedgerCursorError) {
        throw error;
      }

      throw new InvalidLedgerCursorError({ cause: error });
    }
  }

  private static isSupportedPayload(
    payload: unknown,
  ): payload is SerializedLedgerCursor {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return false;
    }

    const record = payload as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return (
      keys.length === 3 &&
      keys[0] === 'createdAt' &&
      keys[1] === 'id' &&
      keys[2] === 'version' &&
      record.version === CURSOR_VERSION &&
      typeof record.createdAt === 'string' &&
      typeof record.id === 'string' &&
      record.id.trim().length > 0
    );
  }
}
