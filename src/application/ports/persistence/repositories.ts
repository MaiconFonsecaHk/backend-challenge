import type { WalletLedgerEntry } from '../../../domain/ledger/wallet-ledger-entry.js';
import type { InboxMessage } from '../../../domain/messaging/inbox-message.js';
import type { OutboxMessage } from '../../../domain/messaging/outbox-message.js';
import type { Money } from '../../../domain/shared/value-objects/money.js';
import type { WagerTransaction } from '../../../domain/wagering/wager-transaction.js';
import type { Wallet } from '../../../domain/wallet/wallet.js';

export interface WalletRepository {
  findById(id: string): Promise<Wallet | undefined>;
  findByPlayerAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | undefined>;
  add(wallet: Wallet): Promise<void>;
  save(wallet: Wallet): Promise<void>;
}

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransactionRecord | undefined>;
  findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransactionRecord | undefined>;
  findByProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionRecord | undefined>;
  add(record: WagerTransactionRecord): Promise<void>;
  save(record: WagerTransactionRecord): Promise<void>;
}

export interface WagerTransactionRecord {
  readonly transaction: WagerTransaction;
  readonly resultBalance?: Money;
  readonly referenceAttempts: number;
  readonly nextReferenceAttemptAt?: Date;
}

export interface WalletLedgerEntryRepository {
  findByWalletAndTransaction(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | undefined>;
  add(entry: WalletLedgerEntry): Promise<void>;
}

export interface InboxMessageRepository {
  findByIdentity(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | undefined>;
  add(message: InboxMessage): Promise<void>;
  save(message: InboxMessage): Promise<void>;
}

export interface OutboxMessageRepository {
  findById(id: string): Promise<OutboxMessage | undefined>;
  add(message: OutboxMessage): Promise<void>;
  save(message: OutboxMessage): Promise<void>;
}

export interface PersistenceRepositories {
  readonly wallets: WalletRepository;
  readonly wagerTransactions: WagerTransactionRepository;
  readonly walletLedgerEntries: WalletLedgerEntryRepository;
  readonly inboxMessages: InboxMessageRepository;
  readonly outboxMessages: OutboxMessageRepository;
}
