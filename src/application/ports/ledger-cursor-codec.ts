import type { WalletLedgerPagePosition } from './persistence/repositories.js';

export const LEDGER_CURSOR_CODEC = Symbol('LEDGER_CURSOR_CODEC');

export interface LedgerCursorCodec {
  encode(position: WalletLedgerPagePosition): string;
  decode(cursor: string): WalletLedgerPagePosition;
}
