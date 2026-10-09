import { Migration } from '@mikro-orm/migrations';

export class Migration20261008021520_enforce_persistence_constraints extends Migration {

  override name = 'Migration20261008021520_enforce_persistence_constraints';

  override up(): void | Promise<void> {
    this.addSql(`alter table "inbox_messages" add constraint "inbox_messages_identity_not_blank_check" check (length(btrim(consumer_name)) > 0 and length(btrim(message_id)) > 0 and length(btrim(payload_hash)) > 0);`);
    this.addSql(`alter table "inbox_messages" add constraint "inbox_messages_timestamp_order_check" check (processed_at is null or processed_at >= received_at);`);

    this.addSql(`alter table "outbox_messages" add constraint "outbox_messages_event_type_not_blank_check" check (length(btrim(event_type)) > 0);`);
    this.addSql(`alter table "outbox_messages" add constraint "outbox_messages_payload_object_check" check (jsonb_typeof(payload) = 'object');`);
    this.addSql(`alter table "outbox_messages" add constraint "outbox_messages_attempts_nonnegative_check" check (attempts >= 0);`);
    this.addSql(`alter table "outbox_messages" add constraint "outbox_messages_publication_state_check" check (published_at is null or next_attempt_at is null);`);
    this.addSql(`alter table "outbox_messages" add constraint "outbox_messages_timestamp_order_check" check ((next_attempt_at is null or next_attempt_at >= occurred_at) and (published_at is null or published_at >= occurred_at));`);

    this.addSql(`alter table "wallets" add constraint "wallets_player_id_currency_unique" unique ("player_id", "currency");`);
    this.addSql(`alter table "wallets" add constraint "wallets_balance_nonnegative_check" check (balance >= 0);`);
    this.addSql(`alter table "wallets" add constraint "wallets_balance_scale_check" check (balance = trunc(balance, 2));`);
    this.addSql(`alter table "wallets" add constraint "wallets_currency_format_check" check (currency ~ '^[A-Z]{3}\$');`);
    this.addSql(`alter table "wallets" add constraint "wallets_version_positive_check" check (version >= 1);`);
    this.addSql(`alter table "wallets" add constraint "wallets_timestamp_order_check" check (updated_at >= created_at);`);
    this.addSql(`create or replace function "wallets_wallets_protect_identity_and_version_fn"() returns trigger as \$\$ begin if new.id is distinct from old.id
          or new.player_id is distinct from old.player_id
          or new.currency is distinct from old.currency
          or new.created_at is distinct from old.created_at then
          raise exception 'wallet identity is immutable' using errcode = '55000';         end if;         if new.balance is distinct from old.balance then
          if new.version <> old.version + 1 then
            raise exception 'wallet version must increment exactly once with balance' using errcode = '23514';           end if;         elsif new.version is distinct from old.version then
          raise exception 'wallet version cannot change without balance' using errcode = '23514';         end if;         return new; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "wallets_protect_identity_and_version" BEFORE UPDATE on "wallets" for each ROW execute function "wallets_wallets_protect_identity_and_version_fn"();`);

    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_idempotency_key_unique" unique ("idempotency_key");`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_provider_external_unique" unique ("provider_id", "external_transaction_id");`);
    this.addSql(`create unique index "wager_transactions_reference_kind_unique" on "wager_transactions" ("reference_transaction_id", "kind") where kind in ('REFUND', 'ROLLBACK') and reference_transaction_id is not null;`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_identity_not_blank_check" check (length(btrim(provider_id)) > 0 and length(btrim(external_transaction_id)) > 0 and length(btrim(idempotency_key)) > 0 and length(btrim(payload_hash)) > 0 and length(btrim(round_id)) > 0 and length(btrim(game_id)) > 0);`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_positive_check" check (amount > 0);`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_amount_scale_check" check (amount = trunc(amount, 2));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_currency_format_check" check (currency ~ '^[A-Z]{3}\$');`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_attempts_check" check (reference_attempts >= 0);`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_external_reference_check" check ((kind in ('REFUND', 'ROLLBACK') and reference_external_transaction_id is not null) or (kind in ('OPENING', 'BET', 'LOSS') and reference_external_transaction_id is null) or kind = 'WIN');`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_reference_not_blank_check" check (reference_external_transaction_id is null or length(btrim(reference_external_transaction_id)) > 0);`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_resolved_reference_check" check ((reference_transaction_id is null or reference_external_transaction_id is not null) and (reference_transaction_id is null or reference_transaction_id <> id) and (status <> 'PENDING_REFERENCE' or (reference_external_transaction_id is not null and reference_transaction_id is null)) and (status <> 'PROCESSED' or reference_external_transaction_id is null or reference_transaction_id is not null));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_terminal_timestamp_check" check ((status in ('PROCESSED', 'REJECTED', 'FAILED') and processed_at is not null) or (status in ('PENDING', 'PENDING_REFERENCE') and processed_at is null));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_failure_code_check" check ((status in ('REJECTED', 'FAILED') and failure_code is not null and failure_code ~ '^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*\$') or (status not in ('REJECTED', 'FAILED') and failure_code is null));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_result_balance_pair_check" check ((result_balance_amount is null) = (result_balance_currency is null));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_result_balance_value_check" check (result_balance_amount is null or (result_balance_amount >= 0 and result_balance_amount = trunc(result_balance_amount, 2)));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_result_currency_format_check" check (result_balance_currency is null or (result_balance_currency ~ '^[A-Z]{3}\$' and result_balance_currency = currency));`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_retry_state_check" check (next_reference_attempt_at is null or status = 'PENDING_REFERENCE');`);
    this.addSql(`alter table "wager_transactions" add constraint "wager_transactions_timestamp_order_check" check (processed_at is null or processed_at >= created_at);`);
    this.addSql(`create or replace function "wager_transactions_wager_transactions_validate_context_fn"() returns trigger as \$\$ begin if tg_op = 'UPDATE' then
          if old.status in ('PROCESSED', 'REJECTED', 'FAILED') and new is distinct from old then
            raise exception 'terminal wager transactions are immutable' using errcode = '55000';           end if;           if new.id is distinct from old.id
            or new.provider_id is distinct from old.provider_id
            or new.external_transaction_id is distinct from old.external_transaction_id
            or new.idempotency_key is distinct from old.idempotency_key
            or new.payload_hash is distinct from old.payload_hash
            or new.wallet_id is distinct from old.wallet_id
            or new.player_id is distinct from old.player_id
            or new.round_id is distinct from old.round_id
            or new.game_id is distinct from old.game_id
            or new.kind is distinct from old.kind
            or new.amount is distinct from old.amount
            or new.currency is distinct from old.currency
            or new.reference_external_transaction_id is distinct from old.reference_external_transaction_id
            or new.created_at is distinct from old.created_at then
            raise exception 'wager transaction identity is immutable' using errcode = '55000';           end if;         end if;         if not exists (
          select 1
          from wallets wallet
          where wallet.id = new.wallet_id
            and wallet.player_id = new.player_id
            and wallet.currency = new.currency
        ) then
          raise exception 'wager transaction wallet context does not match' using errcode = '23514';         end if;         if new.reference_transaction_id is not null and not exists (
          select 1
          from wager_transactions referenced
          where referenced.id = new.reference_transaction_id
            and referenced.external_transaction_id = new.reference_external_transaction_id
            and referenced.provider_id = new.provider_id
            and referenced.player_id = new.player_id
            and referenced.wallet_id = new.wallet_id
            and referenced.currency = new.currency
            and referenced.round_id = new.round_id
            and referenced.status = 'PROCESSED'
            and (
              (new.kind = 'WIN' and referenced.kind = 'BET')
              or (new.kind = 'REFUND' and referenced.kind = 'BET' and new.amount = referenced.amount)
              or (new.kind = 'ROLLBACK' and referenced.kind in ('BET', 'WIN', 'REFUND') and new.amount = referenced.amount)
            )
        ) then
          raise exception 'wager transaction reference context does not match' using errcode = '23514';         end if;         return new; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "wager_transactions_validate_context" BEFORE INSERT OR UPDATE on "wager_transactions" for each ROW execute function "wager_transactions_wager_transactions_validate_context_fn"();`);

    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_wallet_transaction_unique" unique ("wallet_id", "transaction_id");`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_amount_positive_check" check (amount > 0);`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_monetary_scale_check" check (amount = trunc(amount, 2) and balance_before = trunc(balance_before, 2) and balance_after = trunc(balance_after, 2));`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_nonnegative_balances_check" check (balance_before >= 0 and balance_after >= 0);`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_currency_format_check" check (currency ~ '^[A-Z]{3}\$');`);
    this.addSql(`alter table "wallet_ledger_entries" add constraint "wallet_ledger_entries_arithmetic_check" check ((direction = 'DEBIT' and balance_before - amount = balance_after) or (direction = 'CREDIT' and balance_before + amount = balance_after));`);
    this.addSql(`create or replace function "wallet_ledger_entries_wallet_ledger_entries_validate_context_fn"() returns trigger as \$\$ begin if not exists (
          select 1
          from wager_transactions wager
          where wager.id = new.transaction_id
            and wager.wallet_id = new.wallet_id
            and wager.currency = new.currency
            and wager.amount = new.amount
            and wager.status = 'PROCESSED'
            and wager.kind <> 'LOSS'
        ) then
          raise exception 'ledger transaction context does not match' using errcode = '23514';         end if;         return new; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "wallet_ledger_entries_validate_context" BEFORE INSERT on "wallet_ledger_entries" for each ROW execute function "wallet_ledger_entries_wallet_ledger_entries_validate_context_fn"();`);
    this.addSql(`create or replace function "wallet_ledger_entries_wallet_ledger_entries_immutable_fn"() returns trigger as \$\$ begin raise exception 'wallet ledger entries are immutable' using errcode = '55000';         return old; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "wallet_ledger_entries_immutable" BEFORE UPDATE OR DELETE on "wallet_ledger_entries" for each ROW execute function "wallet_ledger_entries_wallet_ledger_entries_immutable_fn"();`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "inbox_messages" drop constraint "inbox_messages_identity_not_blank_check";`);
    this.addSql(`alter table "inbox_messages" drop constraint "inbox_messages_timestamp_order_check";`);

    this.addSql(`alter table "outbox_messages" drop constraint "outbox_messages_event_type_not_blank_check";`);
    this.addSql(`alter table "outbox_messages" drop constraint "outbox_messages_payload_object_check";`);
    this.addSql(`alter table "outbox_messages" drop constraint "outbox_messages_attempts_nonnegative_check";`);
    this.addSql(`alter table "outbox_messages" drop constraint "outbox_messages_publication_state_check";`);
    this.addSql(`alter table "outbox_messages" drop constraint "outbox_messages_timestamp_order_check";`);

    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_idempotency_key_unique";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_provider_external_unique";`);
    this.addSql(`drop index "wager_transactions_reference_kind_unique";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_identity_not_blank_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_positive_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_amount_scale_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_currency_format_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_reference_attempts_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_external_reference_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_reference_not_blank_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_resolved_reference_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_terminal_timestamp_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_failure_code_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_result_balance_pair_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_result_balance_value_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_result_currency_format_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_retry_state_check";`);
    this.addSql(`alter table "wager_transactions" drop constraint "wager_transactions_timestamp_order_check";`);
    this.addSql(`drop trigger if exists "wager_transactions_validate_context" on "wager_transactions";`);
    this.addSql(`drop function if exists "wager_transactions_wager_transactions_validate_context_fn"();`);

    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_wallet_transaction_unique";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_amount_positive_check";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_monetary_scale_check";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_nonnegative_balances_check";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_currency_format_check";`);
    this.addSql(`alter table "wallet_ledger_entries" drop constraint "wallet_ledger_entries_arithmetic_check";`);
    this.addSql(`drop trigger if exists "wallet_ledger_entries_validate_context" on "wallet_ledger_entries";`);
    this.addSql(`drop function if exists "wallet_ledger_entries_wallet_ledger_entries_validate_context_fn"();`);
    this.addSql(`drop trigger if exists "wallet_ledger_entries_immutable" on "wallet_ledger_entries";`);
    this.addSql(`drop function if exists "wallet_ledger_entries_wallet_ledger_entries_immutable_fn"();`);

    this.addSql(`alter table "wallets" drop constraint "wallets_player_id_currency_unique";`);
    this.addSql(`alter table "wallets" drop constraint "wallets_balance_nonnegative_check";`);
    this.addSql(`alter table "wallets" drop constraint "wallets_balance_scale_check";`);
    this.addSql(`alter table "wallets" drop constraint "wallets_currency_format_check";`);
    this.addSql(`alter table "wallets" drop constraint "wallets_version_positive_check";`);
    this.addSql(`alter table "wallets" drop constraint "wallets_timestamp_order_check";`);
    this.addSql(`drop trigger if exists "wallets_protect_identity_and_version" on "wallets";`);
    this.addSql(`drop function if exists "wallets_wallets_protect_identity_and_version_fn"();`);
  }

}
