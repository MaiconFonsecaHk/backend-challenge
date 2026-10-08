import { Migration } from '@mikro-orm/migrations';

export class Migration20261008015154_create_persistence_tables extends Migration {

  override name = 'Migration20261008015154_create_persistence_tables';

  override up(): void | Promise<void> {
    this.addSql(`create table "inbox_messages" ("consumer_name" text not null, "message_id" text not null, "payload_hash" text not null, "received_at" timestamptz not null, "processed_at" timestamptz null, primary key ("consumer_name", "message_id"));`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null, "aggregate_id" uuid not null, "event_type" text not null, "payload" jsonb not null, "occurred_at" timestamptz not null, "attempts" int not null, "next_attempt_at" timestamptz null, "published_at" timestamptz null, primary key ("id"));`);

    this.addSql(`create table "wallets" ("id" uuid not null, "player_id" uuid not null, "currency" char(3) not null, "balance" numeric not null, "version" int not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`create table "wager_transactions" ("id" uuid not null, "provider_id" text not null, "external_transaction_id" text not null, "idempotency_key" text not null, "payload_hash" text not null, "wallet_id" uuid not null, "player_id" uuid not null, "round_id" text not null, "game_id" text not null, "kind" text not null, "status" text not null, "amount" numeric not null, "currency" char(3) not null, "reference_external_transaction_id" text null, "reference_transaction_id" uuid null, "failure_code" text null, "processed_at" timestamptz null, "result_balance_amount" numeric null, "result_balance_currency" char(3) null, "reference_attempts" int not null, "next_reference_attempt_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`create table "wallet_ledger_entries" ("id" uuid not null, "wallet_id" uuid not null, "transaction_id" uuid not null, "direction" text not null, "amount" numeric not null, "balance_before" numeric not null, "balance_after" numeric not null, "currency" char(3) not null, "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_transaction_id_foreign" foreign key ("reference_transaction_id") references "wager_transactions" ("id") on delete restrict;`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_kind_check" check ("kind" in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_status_check" check ("status" in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED'));`);

    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_id_foreign" foreign key ("wallet_id") references "wallets" ("id") on delete restrict;`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_transaction_id_foreign" foreign key ("transaction_id") references "wager_transactions" ("id") on delete restrict;`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_direction_check" check ("direction" in ('DEBIT', 'CREDIT'));`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_wallet_id_foreign";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_wallet_id_foreign";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_reference_transaction_id_foreign";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_transaction_id_foreign";`);

    this.addSql(`drop table if exists "inbox_messages" cascade;`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "wallets" cascade;`);
    this.addSql(`drop table if exists "wager_transactions" cascade;`);
    this.addSql(`drop table if exists "wallet_ledger_entries" cascade;`);
  }

}
