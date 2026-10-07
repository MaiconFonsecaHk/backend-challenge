import { Migration } from '@mikro-orm/migrations';

export class Migration20261007155000Baseline extends Migration {
  override async up(): Promise<void> {
    // Prove the migration pipeline before introducing domain-owned tables.
    this.addSql('select 1;');
  }

  override async down(): Promise<void> {
    // Keep the baseline explicitly reversible without inventing schema.
    this.addSql('select 1;');
  }
}
