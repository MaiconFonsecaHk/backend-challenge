import { Migration } from '@mikro-orm/migrations';

export class Migration20261008023045_add_access_pattern_indexes extends Migration {

  override name = 'Migration20261008023045_add_access_pattern_indexes';

  override up(): void | Promise<void> {
    this.addSql(`create index "outbox_messages_pending_due_idx" on "outbox_messages" ("next_attempt_at" ASC nulls FIRST, "occurred_at" ASC, "id" ASC) where "published_at" is null;`);

    this.addSql(`create index "wager_transactions_pending_reference_due_idx" on "wager_transactions" ("next_reference_attempt_at" ASC nulls FIRST, "id" ASC) where "status" = 'PENDING_REFERENCE';`);

    this.addSql(`create index "wallet_ledger_entries_wallet_cursor_idx" on "wallet_ledger_entries" ("wallet_id", "created_at", "id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index "outbox_messages_pending_due_idx";`);

    this.addSql(`drop index "wager_transactions_pending_reference_due_idx";`);

    this.addSql(`drop index "wallet_ledger_entries_wallet_cursor_idx";`);
  }

}
