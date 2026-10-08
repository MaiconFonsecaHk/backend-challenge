import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MikroORM, ReferenceKind } from '@mikro-orm/postgresql';

import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';
import { InboxMessagePersistenceEntity } from '../../../src/infrastructure/persistence/entities/inbox-message.persistence-entity.js';
import { OutboxMessagePersistenceEntity } from '../../../src/infrastructure/persistence/entities/outbox-message.persistence-entity.js';
import { PERSISTENCE_ENTITIES } from '../../../src/infrastructure/persistence/entities/persistence-entities.js';
import { WagerTransactionPersistenceEntity } from '../../../src/infrastructure/persistence/entities/wager-transaction.persistence-entity.js';
import { WalletLedgerEntryPersistenceEntity } from '../../../src/infrastructure/persistence/entities/wallet-ledger-entry.persistence-entity.js';
import { WalletPersistenceEntity } from '../../../src/infrastructure/persistence/entities/wallet.persistence-entity.js';

const ENTITY_NAMES = {
  inbox: 'InboxMessagePersistenceEntity',
  ledger: 'WalletLedgerEntryPersistenceEntity',
  outbox: 'OutboxMessagePersistenceEntity',
  wager: 'WagerTransactionPersistenceEntity',
  wallet: 'WalletPersistenceEntity',
} as const;

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    dbName: 'persistence_mapping_metadata',
    entities: [...PERSISTENCE_ENTITIES],
  });
});

afterAll(async () => {
  await orm.close(true);
});

function property(entityName: string, propertyName: string) {
  const metadata = entityMetadata(entityName);
  const mappedProperty = metadata.properties[propertyName];

  if (mappedProperty === undefined) {
    throw new Error(`Missing ${entityName}.${propertyName} mapping`);
  }

  return mappedProperty;
}

function entityMetadata(entityName: string) {
  return orm.getMetadata().getByClassName(entityName);
}

describe('persistence entity registry', () => {
  test('registers exactly the five persistence models required by the challenge', () => {
    expect(PERSISTENCE_ENTITIES).toEqual([
      WalletPersistenceEntity,
      WagerTransactionPersistenceEntity,
      WalletLedgerEntryPersistenceEntity,
      InboxMessagePersistenceEntity,
      OutboxMessagePersistenceEntity,
    ]);

    expect(
      PERSISTENCE_ENTITIES.map(
        (entity) => orm.getMetadata().getByClassName(entity.name).tableName,
      ),
    ).toEqual([
      'wallets',
      'wager_transactions',
      'wallet_ledger_entries',
      'inbox_messages',
      'outbox_messages',
    ]);
  });
});

describe('exact monetary mapping', () => {
  test.each([
    [ENTITY_NAMES.wallet, 'balance'],
    [ENTITY_NAMES.wager, 'amount'],
    [ENTITY_NAMES.wager, 'resultBalanceAmount'],
    [ENTITY_NAMES.ledger, 'amount'],
    [ENTITY_NAMES.ledger, 'balanceBefore'],
    [ENTITY_NAMES.ledger, 'balanceAfter'],
  ] as const)('maps %s.%s as a numeric database value and a string at runtime', (
    entityName,
    propertyName,
  ) => {
    const mappedProperty = property(entityName, propertyName);

    expect(mappedProperty.columnTypes).toEqual(['numeric']);
    expect(mappedProperty.runtimeType).toBe('string');
  });

  test.each([
    [ENTITY_NAMES.wallet, 'currency'],
    [ENTITY_NAMES.wager, 'currency'],
    [ENTITY_NAMES.wager, 'resultBalanceCurrency'],
    [ENTITY_NAMES.ledger, 'currency'],
  ] as const)('maps %s.%s as a three-character currency code', (
    entityName,
    propertyName,
  ) => {
    expect(property(entityName, propertyName).columnTypes).toEqual(['char(3)']);
  });
});

describe('financial relationships and state', () => {
  test.each([
    [ENTITY_NAMES.wager, 'walletId', ENTITY_NAMES.wallet, 'wallet_id'],
    [ENTITY_NAMES.wager, 'referenceTransactionId', ENTITY_NAMES.wager, 'reference_transaction_id'],
    [ENTITY_NAMES.ledger, 'walletId', ENTITY_NAMES.wallet, 'wallet_id'],
    [ENTITY_NAMES.ledger, 'transactionId', ENTITY_NAMES.wager, 'transaction_id'],
  ] as const)(
    'maps %s.%s to the target primary key without leaking an ORM reference into repositories',
    (entityName, propertyName, targetName, columnName) => {
      const mappedProperty = property(entityName, propertyName);

      expect(mappedProperty.kind).toBe(ReferenceKind.MANY_TO_ONE);
      expect(mappedProperty.mapToPk).toBe(true);
      expect(mappedProperty.targetMeta?.className).toBe(targetName);
      expect(mappedProperty.fieldNames).toEqual([columnName]);
      expect(mappedProperty.deleteRule).toBe('restrict');
    },
  );

  test('maps transaction kinds, statuses and ledger directions from domain enums', () => {
    expect(property(ENTITY_NAMES.wager, 'kind').items).toEqual(
      Object.values(WagerTransactionKind),
    );
    expect(property(ENTITY_NAMES.wager, 'status').items).toEqual(
      Object.values(WagerTransactionStatus),
    );
    expect(property(ENTITY_NAMES.ledger, 'direction').items).toEqual(
      Object.values(LedgerDirection),
    );
  });

  test('retains the original result and pending-reference schedule required for deterministic recovery', () => {
    expect(property(ENTITY_NAMES.wager, 'resultBalanceAmount').nullable).toBe(true);
    expect(property(ENTITY_NAMES.wager, 'resultBalanceCurrency').nullable).toBe(true);
    expect(property(ENTITY_NAMES.wager, 'referenceAttempts').runtimeType).toBe('number');
    expect(property(ENTITY_NAMES.wager, 'nextReferenceAttemptAt').nullable).toBe(true);
  });
});

describe('messaging persistence', () => {
  test('uses consumer name and message id as the inbox identity', () => {
    const metadata = orm.getMetadata().getByClassName(ENTITY_NAMES.inbox);

    expect(metadata.primaryKeys).toEqual(['consumerName', 'messageId']);
    expect(property(ENTITY_NAMES.inbox, 'consumerName').fieldNames).toEqual([
      'consumer_name',
    ]);
    expect(property(ENTITY_NAMES.inbox, 'messageId').fieldNames).toEqual(['message_id']);
  });

  test('stores the complete outbox envelope as JSONB with retry and publication state', () => {
    expect(property(ENTITY_NAMES.outbox, 'payload').columnTypes).toEqual(['jsonb']);
    expect(property(ENTITY_NAMES.outbox, 'attempts').runtimeType).toBe('number');
    expect(property(ENTITY_NAMES.outbox, 'nextAttemptAt').nullable).toBe(true);
    expect(property(ENTITY_NAMES.outbox, 'publishedAt').nullable).toBe(true);
  });
});

describe('database-enforced invariants', () => {
  test('declares every mandatory uniqueness rule in the persistence metadata', () => {
    expect(
      entityMetadata(ENTITY_NAMES.wallet).uniques.map((constraint) => constraint.name),
    ).toContain('wallets_player_id_currency_unique');
    expect(property(ENTITY_NAMES.wager, 'idempotencyKey').unique).toBe(
      'wager_transactions_idempotency_key_unique',
    );
    expect(
      entityMetadata(ENTITY_NAMES.wager).uniques.map((constraint) => constraint.name),
    ).toEqual([
      'wager_transactions_provider_external_unique',
      'wager_transactions_reference_kind_unique',
    ]);
    expect(
      entityMetadata(ENTITY_NAMES.ledger).uniques.map((constraint) => constraint.name),
    ).toContain('wallet_ledger_entries_wallet_transaction_unique');
    expect(entityMetadata(ENTITY_NAMES.inbox).primaryKeys).toEqual([
      'consumerName',
      'messageId',
    ]);
  });

  test.each([
    [ENTITY_NAMES.wallet, 'wallets_balance_nonnegative_check'],
    [ENTITY_NAMES.wallet, 'wallets_balance_scale_check'],
    [ENTITY_NAMES.wallet, 'wallets_currency_format_check'],
    [ENTITY_NAMES.wager, 'wager_transactions_amount_scale_check'],
    [ENTITY_NAMES.wager, 'wager_transactions_external_reference_check'],
    [ENTITY_NAMES.wager, 'wager_transactions_terminal_timestamp_check'],
    [ENTITY_NAMES.wager, 'wager_transactions_failure_code_check'],
    [ENTITY_NAMES.ledger, 'wallet_ledger_entries_monetary_scale_check'],
    [ENTITY_NAMES.ledger, 'wallet_ledger_entries_arithmetic_check'],
    [ENTITY_NAMES.inbox, 'inbox_messages_identity_not_blank_check'],
    [ENTITY_NAMES.outbox, 'outbox_messages_payload_object_check'],
    [ENTITY_NAMES.outbox, 'outbox_messages_attempts_nonnegative_check'],
  ] as const)('registers %s constraint %s', (entityName, constraintName) => {
    expect(
      entityMetadata(entityName).checks.map((constraint) => constraint.name),
    ).toContain(constraintName);
  });

  test('registers triggers for wallet versioning, transaction context and ledger immutability', () => {
    expect(
      entityMetadata(ENTITY_NAMES.wallet).triggers.map((trigger) => ({
        events: trigger.events,
        name: trigger.name,
      })),
    ).toEqual([
      {
        events: ['update'],
        name: 'wallets_protect_identity_and_version',
      },
    ]);

    expect(
      entityMetadata(ENTITY_NAMES.wager).triggers.map((trigger) => trigger.name),
    ).toEqual(['wager_transactions_validate_context']);
    expect(
      entityMetadata(ENTITY_NAMES.ledger).triggers.map((trigger) => trigger.name),
    ).toEqual([
      'wallet_ledger_entries_validate_context',
      'wallet_ledger_entries_immutable',
    ]);
  });
});
