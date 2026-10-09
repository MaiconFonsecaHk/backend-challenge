import { InboxMessagePersistenceEntity } from './inbox-message.persistence-entity.js';
import { OutboxMessagePersistenceEntity } from './outbox-message.persistence-entity.js';
import { WagerTransactionPersistenceEntity } from './wager-transaction.persistence-entity.js';
import { WalletLedgerEntryPersistenceEntity } from './wallet-ledger-entry.persistence-entity.js';
import { WalletPersistenceEntity } from './wallet.persistence-entity.js';

export const PERSISTENCE_ENTITIES = [
  WalletPersistenceEntity,
  WagerTransactionPersistenceEntity,
  WalletLedgerEntryPersistenceEntity,
  InboxMessagePersistenceEntity,
  OutboxMessagePersistenceEntity,
] as const;
