import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM } from '@mikro-orm/postgresql';

import {
  IdempotencyConflictError,
  InboxPayloadConflictError,
  ProviderTransactionConflictError,
} from '../../../src/application/errors/wager-application.error.js';
import type { Clock } from '../../../src/application/ports/clock.js';
import type { IdGenerator } from '../../../src/application/ports/id-generator.js';
import type {
  OutboxEventPublication,
  OutboxEventTransport,
} from '../../../src/application/ports/outbox-event-transport.js';
import type {
  PersistenceRepositories,
  WalletRepository,
  WagerTransactionRecord,
  WagerTransactionRepository,
} from '../../../src/application/ports/persistence/repositories.js';
import type { UnitOfWork } from '../../../src/application/ports/persistence/unit-of-work.js';
import type {
  NewWagerTransactionExecutor,
  WagerTransactionProcessingCommand,
} from '../../../src/application/ports/wager-transaction-processor.js';
import { PersistentWagerTransactionProcessor } from '../../../src/application/services/persistent-wager-transaction.processor.js';
import { PendingReferenceRetryPolicy } from '../../../src/application/services/pending-reference-retry.policy.js';
import { ExponentialOutboxRetryPolicy } from '../../../src/application/services/exponential-outbox-retry.policy.js';
import { WagerPayloadFingerprintService } from '../../../src/application/services/wager-payload-fingerprint.js';
import { WagerTransactionExecutor } from '../../../src/application/services/wager-transaction.executor.js';
import {
  GetProviderWagerTransactionUseCase,
  GetWagerTransactionByIdUseCase,
} from '../../../src/application/use-cases/wagering/get-wager-transaction.use-cases.js';
import { ProcessWagerTransactionUseCase } from '../../../src/application/use-cases/wagering/process-wager-transaction.use-case.js';
import { PublishOutboxBatchUseCase } from '../../../src/application/use-cases/messaging/publish-outbox-batch.use-case.js';
import { ProcessPendingReferencesBatchUseCase } from '../../../src/application/use-cases/wagering/process-pending-references-batch.use-case.js';
import { CreateWalletUseCase } from '../../../src/application/use-cases/wallet/create-wallet.use-case.js';
import { GetWalletLedgerUseCase } from '../../../src/application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { GetWalletUseCase } from '../../../src/application/use-cases/wallet/get-wallet.use-case.js';
import { ReconcileWalletUseCase } from '../../../src/application/use-cases/wallet/reconcile-wallet.use-case.js';
import { databaseEnvironmentSchema } from '../../../src/config/environment.schema.js';
import { LedgerDirection } from '../../../src/domain/ledger/ledger-direction.js';
import { WalletLedgerEntry } from '../../../src/domain/ledger/wallet-ledger-entry.js';
import { InboxMessage } from '../../../src/domain/messaging/inbox-message.js';
import { OutboxMessage } from '../../../src/domain/messaging/outbox-message.js';
import { Money } from '../../../src/domain/shared/value-objects/money.js';
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from '../../../src/domain/wagering/wager-transaction.js';
import { Wallet } from '../../../src/domain/wallet/wallet.js';
import { mapHttpError } from '../../../src/interfaces/http/http-error-mapper.js';
import { PERSISTENCE_ENTITIES } from '../../../src/infrastructure/persistence/entities/persistence-entities.js';
import { Sha256PayloadDigest } from '../../../src/infrastructure/cryptography/sha256-payload-digest.js';
import { UuidGenerator } from '../../../src/infrastructure/identity/uuid-generator.js';
import { Migration20261007155000Baseline } from '../../../src/infrastructure/persistence/migrations/Migration20261007155000Baseline.js';
import { Migration20261008015154_create_persistence_tables } from '../../../src/infrastructure/persistence/migrations/Migration20261008015154_create_persistence_tables.js';
import { Migration20261008021520_enforce_persistence_constraints } from '../../../src/infrastructure/persistence/migrations/Migration20261008021520_enforce_persistence_constraints.js';
import { Migration20261008023045_add_access_pattern_indexes } from '../../../src/infrastructure/persistence/migrations/Migration20261008023045_add_access_pattern_indexes.js';
import { MikroOrmUnitOfWork } from '../../../src/infrastructure/persistence/mikro-orm.unit-of-work.js';
import { MikroOrmPersistenceConflictClassifier } from '../../../src/infrastructure/persistence/mikro-orm-persistence-conflict.classifier.js';
import { Base64UrlLedgerCursorCodec } from '../../../src/infrastructure/serialization/base64url-ledger-cursor.codec.js';

const APPLICATION_TABLES = [
  'inbox_messages',
  'outbox_messages',
  'wager_transactions',
  'wallet_ledger_entries',
  'wallets',
] as const;
const CREATED_AT = new Date('2026-10-08T12:00:00.000Z');
const PROCESSED_AT = new Date('2026-10-08T12:01:00.000Z');
const EXACT_BALANCE = '9007199254740993.12';
const OPENING_ID = '30000000-0000-4000-8000-000000000101';
const OPENING_LEDGER_ID = '40000000-0000-4000-8000-000000000101';
const OUTBOX_ID = '50000000-0000-4000-8000-000000000101';
const PLAYER_ID = '20000000-0000-4000-8000-000000000101';
const WALLET_ID = '10000000-0000-4000-8000-000000000101';
const TEST_DATABASE_PREFIX = 'backend_challenge_it_';
const integrationEnabled =
  process.env.RUN_POSTGRES_INTEGRATION_TESTS === 'true';
const describePostgreSql = integrationEnabled ? describe : describe.skip;

interface PostgreSqlErrorDetails {
  readonly code?: string;
  readonly constraint?: string;
}

interface TableNameRow {
  readonly table_name: string;
}

interface DivergentWalletRow {
  readonly id: string;
}

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }
}

class SequenceIdGenerator implements IdGenerator {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  generate(): string {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error('Integration id sequence exhausted');
    }

    this.index += 1;
    return value;
  }
}

class ConcurrentLossExecutor implements NewWagerTransactionExecutor {
  executions = 0;
  private barrierArrivals = 0;
  private readonly barrier: Promise<void>;
  private releaseBarrier: (() => void) | undefined;

  constructor(
    private readonly barrierSize: number,
    private readonly eventType = 'IdempotencyProbeProcessed',
  ) {
    this.barrier = new Promise((resolve) => {
      this.releaseBarrier = resolve;
    });
  }

  async execute(
    command: WagerTransactionProcessingCommand,
    wallet: Wallet,
    repositories: PersistenceRepositories,
  ): Promise<WagerTransactionRecord> {
    this.executions += 1;
    if (this.barrierArrivals < this.barrierSize) {
      this.barrierArrivals += 1;
      if (this.barrierArrivals === this.barrierSize) {
        this.releaseBarrier?.();
      }
      await this.barrier;
    }

    const transaction = WagerTransaction.create({
      id: crypto.randomUUID(),
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash: command.payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: Money.from(command.money),
      referenceExternalTransactionId:
        command.referenceExternalTransactionId,
      createdAt: CREATED_AT,
    });
    transaction.markProcessed(undefined, PROCESSED_AT);
    const eventId = crypto.randomUUID();
    await repositories.outboxMessages.add(
      OutboxMessage.rehydrate({
        id: eventId,
        aggregateId: transaction.id,
        eventType: this.eventType,
        payload: {
          eventId,
          transactionId: transaction.id,
        },
        occurredAt: PROCESSED_AT,
        attempts: 0,
      }),
    );

    return {
      transaction,
      resultBalance: wallet.balance,
      referenceAttempts: 0,
    };
  }
}

class PublicationBarrier {
  private arrivals = 0;
  private readonly ready: Promise<void>;
  private release?: () => void;

  constructor(private readonly expectedArrivals: number) {
    this.ready = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  async arrive(): Promise<void> {
    this.arrivals += 1;
    if (this.arrivals === this.expectedArrivals) {
      this.release?.();
    }
    await this.ready;
  }

  get arrivalCount(): number {
    return this.arrivals;
  }
}

function synchronizeWalletLookup(
  unitOfWork: UnitOfWork,
  barrier: PublicationBarrier,
): UnitOfWork {
  return {
    execute: <T>(work: (repositories: PersistenceRepositories) => Promise<T>) =>
      unitOfWork.execute(async (repositories) => {
        const walletRepository: WalletRepository = {
          findById: (id) => repositories.wallets.findById(id),
          findByIdForUpdate: (id) =>
            repositories.wallets.findByIdForUpdate(id),
          findByPlayerAndCurrency: async (playerId, currency) => {
            const wallet =
              await repositories.wallets.findByPlayerAndCurrency(
                playerId,
                currency,
              );
            await barrier.arrive();
            return wallet;
          },
          add: (wallet) => repositories.wallets.add(wallet),
          save: (wallet) => repositories.wallets.save(wallet),
        };

        return work({ ...repositories, wallets: walletRepository });
      }),
  };
}

function synchronizeMissingIdempotencyLookup(
  unitOfWork: UnitOfWork,
  barrier: PublicationBarrier,
): UnitOfWork {
  return {
    execute: <T>(work: (repositories: PersistenceRepositories) => Promise<T>) =>
      unitOfWork.execute(async (repositories) => {
        const wagerTransactions: WagerTransactionRepository = {
          findById: (id) => repositories.wagerTransactions.findById(id),
          findNextPendingReferenceDueForUpdate: (now) =>
            repositories.wagerTransactions.findNextPendingReferenceDueForUpdate(
              now,
            ),
          findByIdempotencyKey: async (idempotencyKey) => {
            const record =
              await repositories.wagerTransactions.findByIdempotencyKey(
                idempotencyKey,
              );
            if (record === undefined) {
              await barrier.arrive();
            }
            return record;
          },
          findByProviderTransaction: (providerId, externalTransactionId) =>
            repositories.wagerTransactions.findByProviderTransaction(
              providerId,
              externalTransactionId,
            ),
          findByReferenceAndKind: (referenceTransactionId, kind) =>
            repositories.wagerTransactions.findByReferenceAndKind(
              referenceTransactionId,
              kind,
            ),
          add: (record) => repositories.wagerTransactions.add(record),
          save: (record) => repositories.wagerTransactions.save(record),
        };

        return work({ ...repositories, wagerTransactions });
      }),
  };
}

class BarrierOutboxTransport implements OutboxEventTransport {
  private firstPublication = true;

  constructor(
    private readonly barrier: PublicationBarrier,
    private readonly publications: OutboxEventPublication[],
  ) {}

  async publish(event: OutboxEventPublication): Promise<void> {
    this.publications.push(event);
    if (this.firstPublication) {
      this.firstPublication = false;
      await this.barrier.arrive();
    }
  }
}

let administrationOrm: MikroORM | undefined;
let applicationOrm: MikroORM | undefined;
let databaseName = '';
const queryLog: string[] = [];

function testEnvironment() {
  return databaseEnvironmentSchema.parse({
    POSTGRES_DB: process.env.POSTGRES_DB ?? 'backend_challenge',
    POSTGRES_HOST: process.env.POSTGRES_HOST ?? '127.0.0.1',
    POSTGRES_PASSWORD:
      process.env.POSTGRES_PASSWORD ?? 'backend_challenge_local',
    POSTGRES_PORT: process.env.POSTGRES_PORT ?? '5432',
    POSTGRES_USER: process.env.POSTGRES_USER ?? 'backend_challenge',
  });
}

function createDatabaseName(): string {
  const randomSuffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  return `${TEST_DATABASE_PREFIX}${process.pid}_${randomSuffix}`.toLowerCase();
}

function quoteTestDatabaseIdentifier(value: string): string {
  if (!/^backend_challenge_it_[a-z0-9_]+$/u.test(value)) {
    throw new Error(`Refusing to use unsafe integration database name: ${value}`);
  }

  return `"${value}"`;
}

function requiredApplicationOrm(): MikroORM {
  if (applicationOrm === undefined) {
    throw new Error('PostgreSQL integration ORM is not initialized');
  }

  return applicationOrm;
}

function requiredAdministrationOrm(): MikroORM {
  if (administrationOrm === undefined) {
    throw new Error('PostgreSQL administration ORM is not initialized');
  }

  return administrationOrm;
}

async function createIndependentApplicationOrm(
  log: string[],
): Promise<MikroORM> {
  const environment = testEnvironment();

  return MikroORM.init({
    dbName: databaseName,
    debug: ['query'],
    entities: [...PERSISTENCE_ENTITIES],
    host: environment.POSTGRES_HOST,
    logger: (message) => log.push(message),
    password: environment.POSTGRES_PASSWORD,
    pool: { max: 1, min: 0 },
    port: environment.POSTGRES_PORT,
    user: environment.POSTGRES_USER,
  });
}

function money(amount: string): Money {
  return Money.from({ amount, currency: 'BRL' });
}

function createWalletUseCase(
  unitOfWork: UnitOfWork,
  idGenerator: IdGenerator,
  clock: Clock,
): CreateWalletUseCase {
  return new CreateWalletUseCase(
    unitOfWork,
    idGenerator,
    clock,
    new MikroOrmPersistenceConflictClassifier(),
  );
}

function createFinancialUseCase(
  orm: MikroORM,
  now: Date = PROCESSED_AT,
): ProcessWagerTransactionUseCase {
  const unitOfWork = new MikroOrmUnitOfWork(orm);

  return new ProcessWagerTransactionUseCase(
    new PersistentWagerTransactionProcessor(
      unitOfWork,
      new WagerTransactionExecutor(
        new UuidGenerator(),
        new FixedClock(now),
        new PendingReferenceRetryPolicy(30, 3_600, 86_400),
      ),
      new MikroOrmPersistenceConflictClassifier(),
    ),
    new WagerPayloadFingerprintService(new Sha256PayloadDigest()),
  );
}

function createPendingReferenceUseCase(
  orm: MikroORM,
  now: Date,
): ProcessPendingReferencesBatchUseCase {
  const clock = new FixedClock(now);
  return new ProcessPendingReferencesBatchUseCase(
    new MikroOrmUnitOfWork(orm),
    new WagerTransactionExecutor(
      new UuidGenerator(),
      clock,
      new PendingReferenceRetryPolicy(30, 3_600, 86_400),
    ),
    clock,
  );
}

function postgresErrorDetails(error: unknown): PostgreSqlErrorDetails {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== undefined; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      break;
    }

    const candidate = current as PostgreSqlErrorDetails & { cause?: unknown };
    if (candidate.code !== undefined) {
      return candidate;
    }

    current = candidate.cause;
  }

  return {};
}

async function expectPostgreSqlError(
  operation: () => Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  let caught: unknown;

  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeDefined();
  const details = postgresErrorDetails(caught);
  expect(details.code).toBe(code);
  if (constraint !== undefined) {
    expect(details.constraint).toBe(constraint);
  }
}

async function applicationTableNames(): Promise<string[]> {
  const rows = await requiredApplicationOrm().em.getConnection().execute<
    TableNameRow[]
  >(
    `select table_name
       from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'inbox_messages',
          'outbox_messages',
          'wager_transactions',
          'wallet_ledger_entries',
          'wallets'
        )
      order by table_name`,
  );

  return rows.map((row) => row.table_name);
}

async function migrateDownCompletely(): Promise<void> {
  const migrator = requiredApplicationOrm().migrator;

  for (let remaining = 10; remaining > 0; remaining -= 1) {
    const executed = await migrator.getExecuted();
    if (executed.length === 0) {
      return;
    }

    await migrator.down();
  }

  throw new Error('Migration rollback exceeded the expected safety limit');
}

function spawnOutboxCrashWorker(now: Date) {
  return Bun.spawn(
    [
      process.execPath,
      'run',
      'test/fixtures/postgresql-crash-worker.ts',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CRASH_TEST_DATABASE: databaseName,
        CRASH_TEST_NOW: now.toISOString(),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}

function spawnFinancialProcess(
  command: Record<string, unknown>,
  startAt: number,
) {
  return Bun.spawn(
    [process.execPath, 'run', 'test/fixtures/financial-process-worker.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FINANCIAL_PROCESS_COMMAND: JSON.stringify(command),
        FINANCIAL_PROCESS_DATABASE: databaseName,
        FINANCIAL_PROCESS_MODE: 'DIRECT',
        FINANCIAL_PROCESS_NOW: PROCESSED_AT.toISOString(),
        FINANCIAL_PROCESS_START_AT: String(startAt),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}

async function readFinancialProcessResult(
  worker: ReturnType<typeof spawnFinancialProcess>,
): Promise<Record<string, unknown>> {
  const [exitCode, stdout, stderr] = await Promise.all([
    worker.exited,
    new Response(worker.stdout).text(),
    new Response(worker.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Financial process exited with ${exitCode}. Output: ${stdout}. Error: ${stderr}`,
    );
  }

  return JSON.parse(stdout.trim()) as Record<string, unknown>;
}

function spawnSqsFinancialProcess(
  mode: 'SQS_ACK' | 'SQS_CRASH',
  queueUrl: string,
) {
  return Bun.spawn(
    [process.execPath, 'run', 'test/fixtures/financial-process-worker.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FINANCIAL_PROCESS_DATABASE: databaseName,
        FINANCIAL_PROCESS_MODE: mode,
        FINANCIAL_PROCESS_NOW: PROCESSED_AT.toISOString(),
        FINANCIAL_PROCESS_QUEUE_URL: queueUrl,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
}

async function waitForFinancialProcessSignal(
  worker: ReturnType<typeof spawnSqsFinancialProcess>,
  expected: string,
): Promise<string> {
  const reader = worker.stdout.getReader();
  const decoder = new TextDecoder();
  let output = '';
  const deadline = Date.now() + 15_000;

  try {
    while (!output.includes(expected)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Financial process did not emit ${expected}. Output: ${output}`,
        );
      }
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(remaining).then(() => {
          throw new Error(
            `Financial process timed out waiting for ${expected}.`,
          );
        }),
      ]);
      if (chunk.done) {
        const stderr = await new Response(worker.stderr).text();
        throw new Error(
          `Financial process exited before ${expected}. Output: ${output}. Error: ${stderr}`,
        );
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
    return output;
  } finally {
    reader.releaseLock();
  }
}

async function waitForWorkerSignal(
  worker: ReturnType<typeof spawnOutboxCrashWorker>,
  expected: string,
): Promise<void> {
  const reader = worker.stdout.getReader();
  const decoder = new TextDecoder();
  let output = '';
  const deadline = Date.now() + 10_000;

  try {
    while (!output.includes(expected)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Crash worker did not emit ${expected}. Output: ${output}`);
      }
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Crash worker timed out waiting for ${expected}.`)),
          remaining,
        );
      });
      const chunk = await Promise.race([reader.read(), timeout]).finally(() => {
        clearTimeout(timeoutId);
      });
      if (chunk.done) {
        const stderr = await new Response(worker.stderr).text();
        throw new Error(
          `Crash worker exited before ${expected}. Output: ${output}. Error: ${stderr}`,
        );
      }
      output += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function persistCompleteOpening(): Promise<void> {
  const wallet = Wallet.open({
    id: WALLET_ID,
    playerId: PLAYER_ID,
    initialBalance: money(EXACT_BALANCE),
    openedAt: CREATED_AT,
  });
  const opening = WagerTransaction.create({
    id: OPENING_ID,
    providerId: 'internal',
    externalTransactionId: `opening:${WALLET_ID}`,
    idempotencyKey: `opening:${WALLET_ID}`,
    payloadHash: 'opening-payload-hash',
    walletId: WALLET_ID,
    playerId: PLAYER_ID,
    roundId: `opening:${WALLET_ID}`,
    gameId: 'internal-wallet-opening',
    kind: WagerTransactionKind.Opening,
    money: money(EXACT_BALANCE),
    createdAt: CREATED_AT,
  });
  opening.markProcessed(undefined, PROCESSED_AT);

  const ledgerEntry = WalletLedgerEntry.create({
    id: OPENING_LEDGER_ID,
    walletId: WALLET_ID,
    transactionId: OPENING_ID,
    direction: LedgerDirection.Credit,
    money: money(EXACT_BALANCE),
    balanceBefore: money('0.00'),
    balanceAfter: money(EXACT_BALANCE),
    createdAt: PROCESSED_AT,
  });
  const inboxMessage = InboxMessage.receive({
    consumerName: 'postgres-integration-test',
    messageId: 'opening-message',
    payloadHash: 'opening-payload-hash',
    receivedAt: CREATED_AT,
  });
  inboxMessage.markProcessed(PROCESSED_AT);
  const outboxMessage = OutboxMessage.rehydrate({
    id: OUTBOX_ID,
    aggregateId: WALLET_ID,
    eventType: 'wallet.opened.v1',
    payload: {
      aggregateId: WALLET_ID,
      balance: { amount: EXACT_BALANCE, currency: 'BRL' },
      eventId: OUTBOX_ID,
    },
    occurredAt: PROCESSED_AT,
    attempts: 0,
  });

  await new MikroOrmUnitOfWork(requiredApplicationOrm()).execute(
    async (repositories) => {
      await repositories.wallets.add(wallet);
      await repositories.wagerTransactions.add({
        transaction: opening,
        resultBalance: wallet.balance,
        referenceAttempts: 0,
      });
      await repositories.walletLedgerEntries.add(ledgerEntry);
      await repositories.inboxMessages.add(inboxMessage);
      await repositories.outboxMessages.add(outboxMessage);
    },
  );
}

describePostgreSql('PostgreSQL schema integration', () => {
  beforeAll(async () => {
    const environment = testEnvironment();
    databaseName = createDatabaseName();
    const quotedDatabaseName = quoteTestDatabaseIdentifier(databaseName);

    administrationOrm = await MikroORM.init({
      dbName: 'postgres',
      entities: [...PERSISTENCE_ENTITIES],
      host: environment.POSTGRES_HOST,
      password: environment.POSTGRES_PASSWORD,
      pool: { max: 1, min: 0 },
      port: environment.POSTGRES_PORT,
      user: environment.POSTGRES_USER,
    });

    await administrationOrm.em
      .getConnection()
      .execute(`create database ${quotedDatabaseName}`);

    applicationOrm = await MikroORM.init({
      dbName: databaseName,
      debug: ['query'],
      entities: [...PERSISTENCE_ENTITIES],
      extensions: [Migrator],
      host: environment.POSTGRES_HOST,
      logger: (message) => queryLog.push(message),
      migrations: {
        allOrNothing: true,
        migrationsList: [
          Migration20261007155000Baseline,
          Migration20261008015154_create_persistence_tables,
          Migration20261008021520_enforce_persistence_constraints,
          Migration20261008023045_add_access_pattern_indexes,
        ],
        snapshot: false,
        transactional: true,
      },
      password: environment.POSTGRES_PASSWORD,
      pool: { max: 5, min: 0 },
      port: environment.POSTGRES_PORT,
      user: environment.POSTGRES_USER,
    });
  });

  afterAll(async () => {
    if (applicationOrm !== undefined) {
      await applicationOrm.close(true);
      applicationOrm = undefined;
    }

    if (administrationOrm !== undefined && databaseName.length > 0) {
      const administrationConnection = administrationOrm.em.getConnection();
      await administrationConnection.execute(
        'select pg_terminate_backend(pid) from pg_stat_activity where datname = ? and pid <> pg_backend_pid()',
        [databaseName],
      );
      await administrationConnection.execute(
        `drop database if exists ${quoteTestDatabaseIdentifier(databaseName)}`,
      );
      await administrationOrm.close(true);
      administrationOrm = undefined;
    }
  });

  afterEach(async () => {
    if (applicationOrm === undefined) {
      return;
    }

    const tables = await applicationTableNames();
    if (!tables.includes('wallets')) {
      return;
    }

    const divergent = await applicationOrm.em.getConnection().execute<
      DivergentWalletRow[]
    >(
      `select wallet.id
         from wallets wallet
         left join wallet_ledger_entries ledger on ledger.wallet_id = wallet.id
        group by wallet.id, wallet.balance
       having wallet.balance <> coalesce(sum(
         case ledger.direction
           when 'CREDIT' then ledger.amount
           when 'DEBIT' then -ledger.amount
         end
       ), 0)`,
    );
    expect(divergent).toEqual([]);
  });

  test('applies every migration to a clean database', async () => {
    const migrator = requiredApplicationOrm().migrator;
    expect(await migrator.getExecuted()).toHaveLength(0);

    await migrator.up();

    expect(
      (await migrator.getExecuted()).map((migration) => migration.name),
    ).toEqual([
      'Migration20261007155000Baseline',
      'Migration20261008015154_create_persistence_tables',
      'Migration20261008021520_enforce_persistence_constraints',
      'Migration20261008023045_add_access_pattern_indexes',
    ]);
    expect(await applicationTableNames()).toEqual([...APPLICATION_TABLES]);
  });

  test('publishes one claimed outbox batch per concurrent instance without overlap', async () => {
    const eventIds = Array.from(
      { length: 6 },
      (_, index) =>
        `50000000-0000-4000-8000-${String(901 + index).padStart(12, '0')}`,
    );
    await new MikroOrmUnitOfWork(requiredApplicationOrm()).execute(
      async (repositories) => {
        for (const [index, eventId] of eventIds.entries()) {
          await repositories.outboxMessages.add(
            OutboxMessage.rehydrate({
              id: eventId,
              aggregateId: `10000000-0000-4000-8000-${String(901 + index).padStart(12, '0')}`,
              eventType: 'OutboxConcurrencyProbe',
              payload: {
                eventId,
                eventType: 'OutboxConcurrencyProbe',
                aggregateId: `10000000-0000-4000-8000-${String(901 + index).padStart(12, '0')}`,
                correlationId: `outbox-concurrency-${index}`,
                occurredAt: CREATED_AT.toISOString(),
                version: 1,
                data: { sequence: index },
              },
              occurredAt: CREATED_AT,
              attempts: 0,
            }),
          );
        }
      },
    );

    const independentQueryLog: string[] = [];
    const instances = await Promise.all(
      Array.from({ length: 2 }, () =>
        createIndependentApplicationOrm(independentQueryLog),
      ),
    );
    const publications: OutboxEventPublication[] = [];
    const barrier = new PublicationBarrier(2);
    try {
      const publishers = instances.map(
        (orm) =>
          new PublishOutboxBatchUseCase(
            new MikroOrmUnitOfWork(orm),
            new BarrierOutboxTransport(barrier, publications),
            new FixedClock(PROCESSED_AT),
            new ExponentialOutboxRetryPolicy(5, 300),
          ),
      );

      const results = await Promise.all(
        publishers.map((publisher) => publisher.execute(3)),
      );

      expect(results).toEqual([
        { claimed: 3, published: 3, failed: 0 },
        { claimed: 3, published: 3, failed: 0 },
      ]);
      expect(publications).toHaveLength(6);
      expect(new Set(publications.map((event) => event.id))).toEqual(
        new Set(eventIds),
      );
      expect(
        independentQueryLog.some((query) =>
          query.toLowerCase().includes('for update') &&
          query.toLowerCase().includes('skip locked'),
        ),
      ).toBeTrue();
    } finally {
      await Promise.all(instances.map((orm) => orm.close(true)));
    }

    const publishedRows = await requiredApplicationOrm().em
      .getConnection()
      .execute<Array<{ attempts: number; id: string; published_at: Date | null }>>(
        `select id, attempts, published_at
           from outbox_messages
          where event_type = 'OutboxConcurrencyProbe'
          order by id`,
      );
    expect(publishedRows.map((row) => row.id)).toEqual(eventIds);
    expect(publishedRows.every((row) => row.attempts === 0)).toBeTrue();
    expect(publishedRows.every((row) => row.published_at !== null)).toBeTrue();
  });

  test('does not publish a later aggregate event while its predecessor is waiting for retry', async () => {
    const blockedAggregateId = '10000000-0000-4000-8000-000000000920';
    const earlierEventId = '50000000-0000-4000-8000-000000000920';
    const laterEventId = '50000000-0000-4000-8000-000000000921';
    const independentEventId = '50000000-0000-4000-8000-000000000922';
    const laterOccurredAt = new Date('2026-10-08T12:00:30.000Z');
    const retryAt = new Date('2026-10-08T13:00:00.000Z');
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await unitOfWork.execute(async (repositories) => {
      for (const message of [
        OutboxMessage.rehydrate({
          id: earlierEventId,
          aggregateId: blockedAggregateId,
          eventType: 'OutboxOrderingProbe',
          payload: { eventId: earlierEventId },
          occurredAt: CREATED_AT,
          attempts: 1,
          nextAttemptAt: retryAt,
        }),
        OutboxMessage.rehydrate({
          id: laterEventId,
          aggregateId: blockedAggregateId,
          eventType: 'OutboxOrderingProbe',
          payload: { eventId: laterEventId },
          occurredAt: laterOccurredAt,
          attempts: 0,
        }),
        OutboxMessage.rehydrate({
          id: independentEventId,
          aggregateId: '10000000-0000-4000-8000-000000000922',
          eventType: 'OutboxOrderingProbe',
          payload: { eventId: independentEventId },
          occurredAt: CREATED_AT,
          attempts: 0,
        }),
      ]) {
        await repositories.outboxMessages.add(message);
      }
    });
    const publications: OutboxEventPublication[] = [];
    const transport: OutboxEventTransport = {
      publish: async (event) => {
        publications.push(event);
      },
    };
    const publisher = new PublishOutboxBatchUseCase(
      unitOfWork,
      transport,
      new FixedClock(PROCESSED_AT),
      new ExponentialOutboxRetryPolicy(5, 300),
    );

    expect(await publisher.execute(10)).toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(publications.map((event) => event.id)).toEqual([
      independentEventId,
    ]);
    const rows = await requiredApplicationOrm().em
      .getConnection()
      .execute<Array<{ id: string; published_at: Date | null }>>(
        `select id, published_at
           from outbox_messages
          where event_type = 'OutboxOrderingProbe'
          order by id`,
      );
    expect(
      rows.map((row) => ({
        id: row.id,
        published: row.published_at !== null,
      })),
    ).toEqual([
      { id: earlierEventId, published: false },
      { id: laterEventId, published: false },
      { id: independentEventId, published: true },
    ]);
  });

  test('persists a failed publication retry and recovers when it becomes due', async () => {
    const eventId = '50000000-0000-4000-8000-000000000930';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await unitOfWork.execute(async (repositories) => {
      await repositories.outboxMessages.add(
        OutboxMessage.rehydrate({
          id: eventId,
          aggregateId: '10000000-0000-4000-8000-000000000930',
          eventType: 'OutboxRetryProbe',
          payload: { eventId },
          occurredAt: CREATED_AT,
          attempts: 0,
        }),
      );
    });

    const retryPolicy = new ExponentialOutboxRetryPolicy(5, 300);
    const failingPublisher = new PublishOutboxBatchUseCase(
      unitOfWork,
      {
        publish: async () => {
          throw new Error('temporary transport failure');
        },
      },
      new FixedClock(PROCESSED_AT),
      retryPolicy,
    );

    expect(await failingPublisher.execute(10)).toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
    });

    const [retryRow] = await requiredApplicationOrm().em
      .getConnection()
      .execute<
        Array<{
          attempts: number;
          next_attempt_at: Date | string;
          published_at: Date | string | null;
        }>
      >(
        `select attempts, next_attempt_at, published_at
           from outbox_messages
          where id = ?`,
        [eventId],
      );
    expect(retryRow?.attempts).toBe(1);
    expect(new Date(retryRow!.next_attempt_at).toISOString()).toBe(
      '2026-10-08T12:01:05.000Z',
    );
    expect(retryRow?.published_at).toBeNull();

    const publications: OutboxEventPublication[] = [];
    const successfulTransport: OutboxEventTransport = {
      publish: async (event) => {
        publications.push(event);
      },
    };
    const notYetDuePublisher = new PublishOutboxBatchUseCase(
      unitOfWork,
      successfulTransport,
      new FixedClock(new Date('2026-10-08T12:01:04.000Z')),
      retryPolicy,
    );
    expect(await notYetDuePublisher.execute(10)).toEqual({
      claimed: 0,
      published: 0,
      failed: 0,
    });

    const recoveredPublisher = new PublishOutboxBatchUseCase(
      unitOfWork,
      successfulTransport,
      new FixedClock(new Date('2026-10-08T12:01:05.000Z')),
      retryPolicy,
    );
    expect(await recoveredPublisher.execute(10)).toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(publications.map((event) => event.id)).toEqual([eventId]);

    const publishedMessage = await unitOfWork.execute((repositories) =>
      repositories.outboxMessages.findById(eventId),
    );
    expect(publishedMessage?.attempts).toBe(1);
    expect(publishedMessage?.nextAttemptAt).toBeUndefined();
    expect(publishedMessage?.publishedAt?.toISOString()).toBe(
      '2026-10-08T12:01:05.000Z',
    );
  });

  test('another publisher recovers an outbox claim after the worker process crashes', async () => {
    const eventId = '50000000-0000-4000-8000-000000000932';
    const aggregateId = '10000000-0000-4000-8000-000000000932';
    const crashInstant = new Date('2026-10-08T12:02:00.000Z');
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await unitOfWork.execute(async (repositories) => {
      await repositories.outboxMessages.add(
        OutboxMessage.rehydrate({
          id: eventId,
          aggregateId,
          eventType: 'OutboxCrashRecoveryProbe',
          payload: { eventId },
          occurredAt: new Date('2000-01-01T00:00:00.000Z'),
          attempts: 0,
        }),
      );
    });

    const worker = spawnOutboxCrashWorker(crashInstant);
    try {
      await waitForWorkerSignal(worker, `CLAIMED:${eventId}`);
    } finally {
      worker.kill();
      await worker.exited;
    }

    const publications: OutboxEventPublication[] = [];
    const publisher = new PublishOutboxBatchUseCase(
      unitOfWork,
      {
        publish: async (event) => {
          publications.push(event);
        },
      },
      new FixedClock(crashInstant),
      new ExponentialOutboxRetryPolicy(5, 300),
    );

    expect(await publisher.execute(1)).toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
    });
    expect(publications.map((event) => event.id)).toEqual([eventId]);
    const recovered = await unitOfWork.execute((repositories) =>
      repositories.outboxMessages.findById(eventId),
    );
    expect(recovered?.publishedAt?.toISOString()).toBe(
      crashInstant.toISOString(),
    );
  }, 20_000);

  test('recovers a refund delivered before its reference without breaking ledger consistency', async () => {
    const walletId = '10000000-0000-4000-8000-000000000931';
    const playerId = '20000000-0000-4000-8000-000000000931';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000931',
        '40000000-0000-4000-8000-000000000931',
        '50000000-0000-4000-8000-000000000931',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-create-reference-931',
    });
    const financial = createFinancialUseCase(requiredApplicationOrm());
    const submit = (
      externalTransactionId: string,
      kind: WagerTransactionKind,
      referenceExternalTransactionId?: string,
    ) =>
      financial.execute({
        providerId: 'provider-reference-931',
        externalTransactionId,
        idempotencyKey: `provider-reference-931:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: 'round-reference-931',
        gameId: 'game-reference-931',
        kind,
        money: { amount: '25.00', currency: 'BRL' },
        ...(referenceExternalTransactionId === undefined
          ? {}
          : { referenceExternalTransactionId }),
        correlationId: `correlation-${externalTransactionId}`,
      });

    const refund = await submit(
      'refund-before-bet-931',
      WagerTransactionKind.Refund,
      'bet-after-refund-931',
    );
    expect(refund.status).toBe(WagerTransactionStatus.PendingReference);
    const pending = await unitOfWork.execute((repositories) =>
      repositories.wagerTransactions.findById(refund.transactionId),
    );
    expect(pending?.referenceAttempts).toBe(1);
    expect(pending?.nextReferenceAttemptAt?.toISOString()).toBe(
      '2026-10-08T12:01:30.000Z',
    );

    const bet = await submit(
      'bet-after-refund-931',
      WagerTransactionKind.Bet,
    );
    expect(bet).toMatchObject({
      status: WagerTransactionStatus.Processed,
      balance: { amount: '75.00', currency: 'BRL' },
    });

    const claimLog: string[] = [];
    const [abandonedClaimOrm, competingClaimOrm] = await Promise.all([
      createIndependentApplicationOrm(claimLog),
      createIndependentApplicationOrm(claimLog),
    ]);
    let announceClaim!: () => void;
    const claimStarted = new Promise<void>((resolve) => {
      announceClaim = resolve;
    });
    let releaseClaim!: () => void;
    const claimRelease = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    try {
      const abandonedClaim = new MikroOrmUnitOfWork(
        abandonedClaimOrm,
      ).execute(async (repositories) => {
        const claimed =
          await repositories.wagerTransactions.findNextPendingReferenceDueForUpdate(
            new Date('2026-10-08T12:01:30.000Z'),
          );
        expect(claimed?.transaction.id).toBe(refund.transactionId);
        announceClaim();
        await claimRelease;
        throw new Error('simulated worker termination');
      });
      await claimStarted;

      const competingClaim = await new MikroOrmUnitOfWork(
        competingClaimOrm,
      ).execute((repositories) =>
        repositories.wagerTransactions.findNextPendingReferenceDueForUpdate(
          new Date('2026-10-08T12:01:30.000Z'),
        ),
      );
      expect(competingClaim).toBeUndefined();

      releaseClaim();
      await expect(abandonedClaim).rejects.toThrow(
        'simulated worker termination',
      );
    } finally {
      releaseClaim();
      await Promise.all([
        abandonedClaimOrm.close(true),
        competingClaimOrm.close(true),
      ]);
    }
    expect(
      claimLog.some((query) =>
        query.toLowerCase().includes('skip locked'),
      ),
    ).toBeTrue();

    const recovery = createPendingReferenceUseCase(
      requiredApplicationOrm(),
      new Date('2026-10-08T12:01:30.000Z'),
    );
    expect(await recovery.execute(10)).toEqual({
      claimed: 1,
      processed: 1,
      rejected: 0,
      rescheduled: 0,
    });

    const recovered = await unitOfWork.execute((repositories) =>
      repositories.wagerTransactions.findById(refund.transactionId),
    );
    expect(recovered?.transaction.status).toBe(
      WagerTransactionStatus.Processed,
    );
    expect(recovered?.transaction.referenceTransactionId).toBe(
      bet.transactionId,
    );
    expect(recovered?.referenceAttempts).toBe(1);
    expect(recovered?.nextReferenceAttemptAt).toBeUndefined();

    const reconciliation = await new ReconcileWalletUseCase(unitOfWork).execute(
      walletId,
    );
    expect(reconciliation).toMatchObject({
      storedBalance: { amount: '100.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 3,
    });
  });

  test('rejects an expired missing reference and emits an auditable terminal event', async () => {
    const walletId = '10000000-0000-4000-8000-000000000932';
    const playerId = '20000000-0000-4000-8000-000000000932';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([walletId]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '0.00', currency: 'BRL' },
      correlationId: 'wallet-create-reference-932',
    });
    const pending = await createFinancialUseCase(
      requiredApplicationOrm(),
    ).execute({
      providerId: 'provider-reference-932',
      externalTransactionId: 'refund-missing-932',
      idempotencyKey: 'provider-reference-932:refund-missing-932',
      playerId,
      walletId,
      roundId: 'round-reference-932',
      gameId: 'game-reference-932',
      kind: WagerTransactionKind.Refund,
      money: { amount: '25.00', currency: 'BRL' },
      referenceExternalTransactionId: 'missing-bet-932',
      correlationId: 'correlation-refund-missing-932',
    });
    const expiredAt = new Date(
      PROCESSED_AT.getTime() + 86_400 * 1_000,
    );

    expect(
      await createPendingReferenceUseCase(
        requiredApplicationOrm(),
        expiredAt,
      ).execute(10),
    ).toEqual({
      claimed: 1,
      processed: 0,
      rejected: 1,
      rescheduled: 0,
    });

    const rejected = await unitOfWork.execute((repositories) =>
      repositories.wagerTransactions.findById(pending.transactionId),
    );
    expect(rejected?.transaction.status).toBe(
      WagerTransactionStatus.Rejected,
    );
    expect(rejected?.transaction.failureCode).toBe('REFERENCE_NOT_FOUND');
    expect(rejected?.transaction.processedAt?.toISOString()).toBe(
      expiredAt.toISOString(),
    );
    expect(rejected?.nextReferenceAttemptAt).toBeUndefined();

    const rejectionEvents = await requiredApplicationOrm().em
      .getConnection()
      .execute<Array<{ count: string }>>(
        `select count(*)::text as count
           from outbox_messages
          where aggregate_id = ?
            and event_type = 'WagerTransactionRejected'`,
        [pending.transactionId],
      );
    expect(rejectionEvents[0]?.count).toBe('1');
    expect(
      await new ReconcileWalletUseCase(unitOfWork).execute(walletId),
    ).toMatchObject({
      storedBalance: { amount: '0.00', currency: 'BRL' },
      calculatedBalance: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 0,
    });
  });

  test('commits and rehydrates a complete opening without monetary precision loss', async () => {
    await persistCompleteOpening();

    await new MikroOrmUnitOfWork(requiredApplicationOrm()).execute(
      async (repositories) => {
        const wallet = await repositories.wallets.findById(WALLET_ID);
        const opening = await repositories.wagerTransactions.findById(OPENING_ID);
        const ledgerEntry =
          await repositories.walletLedgerEntries.findByWalletAndTransaction(
            WALLET_ID,
            OPENING_ID,
          );
        const inboxMessage = await repositories.inboxMessages.findByIdentity(
          'postgres-integration-test',
          'opening-message',
        );
        const outboxMessage = await repositories.outboxMessages.findById(OUTBOX_ID);

        expect(wallet?.balance.toJSON()).toEqual({
          amount: EXACT_BALANCE,
          currency: 'BRL',
        });
        expect(opening?.resultBalance?.toJSON()).toEqual({
          amount: EXACT_BALANCE,
          currency: 'BRL',
        });
        expect(ledgerEntry?.balanceAfter.toJSON()).toEqual({
          amount: EXACT_BALANCE,
          currency: 'BRL',
        });
        expect(inboxMessage?.isProcessed()).toBe(true);
        expect(outboxMessage?.payload).toEqual({
          aggregateId: WALLET_ID,
          balance: { amount: EXACT_BALANCE, currency: 'BRL' },
          eventId: OUTBOX_ID,
        });
      },
    );
  });

  test('creates a wallet with atomic opening, ledger, and outbox records', async () => {
    const walletId = '10000000-0000-4000-8000-000000000105';
    const playerId = '20000000-0000-4000-8000-000000000105';
    const openingId = '30000000-0000-4000-8000-000000000105';
    const ledgerId = '40000000-0000-4000-8000-000000000105';
    const eventId = '50000000-0000-4000-8000-000000000105';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    const useCase = createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([walletId, openingId, ledgerId, eventId]),
      new FixedClock(CREATED_AT),
    );

    const result = await useCase.execute({
      playerId,
      initialBalance: { amount: '250.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-105',
    });

    expect(result).toEqual({
      id: walletId,
      playerId,
      balance: { amount: '250.00', currency: 'BRL' },
      version: 1,
    });

    await unitOfWork.execute(async (repositories) => {
      const wallet = await repositories.wallets.findById(walletId);
      const opening = await repositories.wagerTransactions.findById(openingId);
      const ledger =
        await repositories.walletLedgerEntries.findByWalletAndTransaction(
          walletId,
          openingId,
        );
      const outbox = await repositories.outboxMessages.findById(eventId);

      expect(wallet?.balance.toJSON()).toEqual({
        amount: '250.00',
        currency: 'BRL',
      });
      expect(opening?.transaction.kind).toBe(WagerTransactionKind.Opening);
      expect(opening?.transaction.status).toBe(WagerTransactionStatus.Processed);
      expect(opening?.resultBalance?.toJSON()).toEqual({
        amount: '250.00',
        currency: 'BRL',
      });
      expect(ledger?.direction).toBe(LedgerDirection.Credit);
      expect(ledger?.balanceBefore.toJSON().amount).toBe('0.00');
      expect(ledger?.balanceAfter.toJSON().amount).toBe('250.00');
      expect(outbox?.eventType).toBe('WalletBalanceChanged');
      expect(outbox?.payload).toEqual(
        expect.objectContaining({
          aggregateId: walletId,
          causationId: openingId,
          correlationId: 'wallet-create-integration-105',
          eventId,
        }),
      );
    });

    const [reconciliation] = await requiredApplicationOrm().em
      .getConnection()
      .execute<Array<{ reconciled: boolean }>>(
        `select wallet.balance = coalesce(sum(
           case ledger.direction
             when 'CREDIT' then ledger.amount
             when 'DEBIT' then -ledger.amount
           end
         ), 0) as reconciled
           from wallets wallet
           left join wallet_ledger_entries ledger on ledger.wallet_id = wallet.id
          where wallet.id = ?
          group by wallet.id, wallet.balance`,
        [walletId],
      );
    expect(reconciliation?.reconciled).toBe(true);
  });

  test('returns one 409 conflict when two instances concurrently create the same wallet', async () => {
    const playerId = '20000000-0000-4000-8000-000000000116';
    const firstWalletId = '10000000-0000-4000-8000-000000000116';
    const secondWalletId = '10000000-0000-4000-8000-000000000117';
    const firstOrm = await createIndependentApplicationOrm([]);
    const secondOrm = await createIndependentApplicationOrm([]);
    const barrier = new PublicationBarrier(2);

    try {
      const firstUseCase = createWalletUseCase(
        synchronizeWalletLookup(new MikroOrmUnitOfWork(firstOrm), barrier),
        new SequenceIdGenerator([firstWalletId]),
        new FixedClock(CREATED_AT),
      );
      const secondUseCase = createWalletUseCase(
        synchronizeWalletLookup(new MikroOrmUnitOfWork(secondOrm), barrier),
        new SequenceIdGenerator([secondWalletId]),
        new FixedClock(CREATED_AT),
      );
      const command = {
        playerId,
        initialBalance: { amount: '0.00', currency: 'BRL' },
        correlationId: 'wallet-concurrent-create-106',
      } as const;

      const results = await Promise.allSettled([
        firstUseCase.execute(command),
        secondUseCase.execute(command),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0]?.status !== 'rejected') {
        throw new Error('Expected one concurrent wallet creation to fail');
      }

      expect(mapHttpError(rejected[0].reason)).toEqual(
        expect.objectContaining({
          status: 409,
          body: expect.objectContaining({
            statusCode: 409,
            code: 'WALLET_ALREADY_EXISTS',
          }),
        }),
      );

      const persistedWallets = await requiredApplicationOrm().em
        .getConnection()
        .execute<Array<{ id: string }>>(
          `select id
             from wallets
            where player_id = ? and currency = ?`,
          [playerId, 'BRL'],
        );
      expect(persistedWallets).toHaveLength(1);
      const persistedWallet = persistedWallets[0];
      if (persistedWallet === undefined) {
        throw new Error('Expected the winning wallet to be persisted');
      }
      expect([firstWalletId, secondWalletId]).toContain(persistedWallet.id);

      const reconciliation = await new ReconcileWalletUseCase(
        new MikroOrmUnitOfWork(requiredApplicationOrm()),
      ).execute(persistedWallet.id);
      expect(reconciliation).toEqual(
        expect.objectContaining({
          storedBalance: { amount: '0.00', currency: 'BRL' },
          calculatedBalance: { amount: '0.00', currency: 'BRL' },
          difference: { amount: '0.00', currency: 'BRL' },
          checkedEntries: 0,
          consistent: true,
        }),
      );
    } finally {
      await Promise.all([firstOrm.close(true), secondOrm.close(true)]);
    }
  });

  test('queries wallets, paginates the ledger, and exposes divergence without correction', async () => {
    const walletId = '10000000-0000-4000-8000-000000000107';
    const playerId = '20000000-0000-4000-8000-000000000107';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    const ledgerCreatedAt = new Date('2026-10-08T13:00:00.000Z');

    await unitOfWork.execute(async (repositories) => {
      await repositories.wallets.add(
        Wallet.open({
          id: walletId,
          playerId,
          initialBalance: money('0.00'),
          openedAt: CREATED_AT,
        }),
      );
    });

    const persistCredit = async (sequence: number, createdAt: Date) => {
      const suffix = sequence.toString().padStart(12, '0');
      const transactionId = `30000000-0000-4000-8000-${suffix}`;
      const ledgerId = `40000000-0000-4000-8000-${suffix}`;

      await unitOfWork.execute(async (repositories) => {
        const wallet = await repositories.wallets.findById(walletId);
        if (wallet === undefined) {
          throw new Error('Ledger query fixture wallet was not persisted');
        }

        const transaction = WagerTransaction.create({
          id: transactionId,
          providerId: 'ledger-query-probe',
          externalTransactionId: `ledger-query-${sequence}`,
          idempotencyKey: `ledger-query-probe:${sequence}`,
          payloadHash: `ledger-query-payload-${sequence}`,
          walletId,
          playerId,
          roundId: `ledger-query-round-${sequence}`,
          gameId: 'ledger-query-game',
          kind: WagerTransactionKind.Win,
          money: money('10.00'),
          createdAt,
        });
        const change = wallet.credit(money('10.00'), createdAt);
        transaction.markProcessed(undefined, createdAt);

        await repositories.wagerTransactions.add({
          transaction,
          resultBalance: change.balanceAfter,
          referenceAttempts: 0,
        });
        await repositories.walletLedgerEntries.add(
          WalletLedgerEntry.create({
            id: ledgerId,
            walletId,
            transactionId,
            direction: change.direction,
            money: change.money,
            balanceBefore: change.balanceBefore,
            balanceAfter: change.balanceAfter,
            createdAt,
          }),
        );
        await repositories.wallets.save(wallet);
      });

      return ledgerId;
    };

    const firstLedgerId = await persistCredit(201, ledgerCreatedAt);
    const secondLedgerId = await persistCredit(202, ledgerCreatedAt);
    const thirdLedgerId = await persistCredit(203, ledgerCreatedAt);
    const cursorCodec = new Base64UrlLedgerCursorCodec();
    const ledgerQuery = new GetWalletLedgerUseCase(unitOfWork, cursorCodec);

    const firstPage = await ledgerQuery.execute({ walletId, limit: 2 });

    expect(firstPage.items.map((item) => item.id)).toEqual([
      thirdLedgerId,
      secondLedgerId,
    ]);
    expect(firstPage.nextCursor).toBeDefined();
    const firstPageCursor = firstPage.nextCursor;
    if (firstPageCursor === undefined) {
      throw new Error('First ledger page did not provide a continuation cursor');
    }

    const newestLedgerId = await persistCredit(
      204,
      new Date('2026-10-08T13:01:00.000Z'),
    );
    const secondPage = await ledgerQuery.execute({
      walletId,
      cursor: firstPageCursor,
      limit: 2,
    });
    const freshFirstPage = await ledgerQuery.execute({ walletId, limit: 2 });
    const wallet = await new GetWalletUseCase(unitOfWork).execute(walletId);

    expect(secondPage.items.map((item) => item.id)).toEqual([firstLedgerId]);
    expect(secondPage.nextCursor).toBeUndefined();
    expect(freshFirstPage.items.map((item) => item.id)).toEqual([
      newestLedgerId,
      thirdLedgerId,
    ]);
    expect(wallet).toEqual({
      id: walletId,
      playerId,
      balance: { amount: '40.00', currency: 'BRL' },
      version: 5,
    });

    const reconciliationUseCase = new ReconcileWalletUseCase(unitOfWork);
    expect(await reconciliationUseCase.execute(walletId)).toEqual({
      walletId,
      storedBalance: { amount: '40.00', currency: 'BRL' },
      calculatedBalance: { amount: '40.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 4,
    });

    await requiredApplicationOrm().em.execute(
      `update wallets
          set balance = '41.00', version = version + 1, updated_at = ?
        where id = ?`,
      [new Date('2026-10-08T13:02:00.000Z'), walletId],
    );
    queryLog.length = 0;

    expect(await reconciliationUseCase.execute(walletId)).toEqual({
      walletId,
      storedBalance: { amount: '41.00', currency: 'BRL' },
      calculatedBalance: { amount: '40.00', currency: 'BRL' },
      difference: { amount: '1.00', currency: 'BRL' },
      consistent: false,
      checkedEntries: 4,
    });
    expect(
      queryLog.some((message) => message.includes('update "wallets"')),
    ).toBe(false);
    expect(await new GetWalletUseCase(unitOfWork).execute(walletId)).toEqual({
      id: walletId,
      playerId,
      balance: { amount: '41.00', currency: 'BRL' },
      version: 6,
    });
    await requiredApplicationOrm().em.getConnection().execute(
      `update wallets
          set balance = ?, version = version + 1, updated_at = ?
        where id = ?`,
      ['40.00', new Date('2026-10-08T13:03:00.000Z'), walletId],
    );
  });

  test('reconciles a persisted zero-balance wallet without ledger entries', async () => {
    const walletId = '10000000-0000-4000-8000-000000000108';
    const playerId = '20000000-0000-4000-8000-000000000108';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    const createWallet = createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([walletId]),
      new FixedClock(CREATED_AT),
    );

    await createWallet.execute({
      playerId,
      initialBalance: { amount: '0.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-108',
    });

    expect(
      await new ReconcileWalletUseCase(unitOfWork).execute(walletId),
    ).toEqual({
      walletId,
      storedBalance: { amount: '0.00', currency: 'BRL' },
      calculatedBalance: { amount: '0.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 0,
    });
  });

  test('serializes one wallet across three instances while distinct wallets stay parallel', async () => {
    const firstWalletId = '10000000-0000-4000-8000-000000000110';
    const firstPlayerId = '20000000-0000-4000-8000-000000000110';
    const secondWalletId = '10000000-0000-4000-8000-000000000111';
    const secondPlayerId = '20000000-0000-4000-8000-000000000111';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([firstWalletId]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId: firstPlayerId,
      initialBalance: { amount: '0.00', currency: 'BRL' },
      correlationId: 'wallet-lock-integration-110',
    });
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([secondWalletId]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId: secondPlayerId,
      initialBalance: { amount: '0.00', currency: 'BRL' },
      correlationId: 'wallet-lock-integration-111',
    });

    const independentQueryLog: string[] = [];
    const instances = await Promise.all(
      Array.from({ length: 3 }, () =>
        createIndependentApplicationOrm(independentQueryLog),
      ),
    );

    try {
      let activeSameWallet = 0;
      let maxActiveSameWallet = 0;
      await Promise.all(
        instances.map((orm) =>
          new MikroOrmUnitOfWork(orm).execute(async (repositories) => {
            const locked = await repositories.wallets.findByIdForUpdate(
              firstWalletId,
            );
            if (locked === undefined) {
              throw new Error('Wallet lock probe could not find its wallet');
            }

            activeSameWallet += 1;
            maxActiveSameWallet = Math.max(
              maxActiveSameWallet,
              activeSameWallet,
            );
            await new Promise((resolve) => setTimeout(resolve, 30));
            activeSameWallet -= 1;
          }),
        ),
      );
      expect(maxActiveSameWallet).toBe(1);

      let releaseDistinctWallets: (() => void) | undefined;
      const distinctWalletBarrier = new Promise<void>((resolve) => {
        releaseDistinctWallets = resolve;
      });
      let distinctWalletArrivals = 0;
      let activeDistinctWallets = 0;
      let maxActiveDistinctWallets = 0;
      const lockDistinctWallet = async (orm: MikroORM, walletId: string) =>
        new MikroOrmUnitOfWork(orm).execute(async (repositories) => {
          const locked = await repositories.wallets.findByIdForUpdate(walletId);
          if (locked === undefined) {
            throw new Error('Distinct wallet lock probe could not find its wallet');
          }

          activeDistinctWallets += 1;
          maxActiveDistinctWallets = Math.max(
            maxActiveDistinctWallets,
            activeDistinctWallets,
          );
          distinctWalletArrivals += 1;
          if (distinctWalletArrivals === 2) {
            releaseDistinctWallets?.();
          }
          await distinctWalletBarrier;
          activeDistinctWallets -= 1;
        });

      const firstInstance = instances[0];
      const secondInstance = instances[1];
      if (firstInstance === undefined || secondInstance === undefined) {
        throw new Error('Three independent ORM instances were not created');
      }
      await Promise.all([
        lockDistinctWallet(firstInstance, firstWalletId),
        lockDistinctWallet(secondInstance, secondWalletId),
      ]);

      expect(maxActiveDistinctWallets).toBe(2);
      expect(
        independentQueryLog.filter((message) =>
          message.toLowerCase().includes('for update'),
        ).length,
      ).toBeGreaterThanOrEqual(5);
    } finally {
      await Promise.all(instances.map((orm) => orm.close(true)));
    }
  });

  test('serializes three independent Bun processes competing for one wallet', async () => {
    const walletId = '10000000-0000-4000-8000-000000000119';
    const playerId = '20000000-0000-4000-8000-000000000119';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000119',
        '40000000-0000-4000-8000-000000000119',
        '50000000-0000-4000-8000-000000000119',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-process-integration-119',
    });

    const startAt = Date.now() + 2_000;
    const workers = Array.from({ length: 3 }, (_, index) =>
      spawnFinancialProcess(
        {
          providerId: 'provider-processes',
          externalTransactionId: `bet-process-${index + 1}`,
          idempotencyKey: `provider-processes:bet-${index + 1}`,
          playerId,
          walletId,
          roundId: 'round-processes-119',
          gameId: 'game-processes-119',
          kind: WagerTransactionKind.Bet,
          money: { amount: '80.00', currency: 'BRL' },
          correlationId: `process-${index + 1}`,
        },
        startAt,
      ),
    );
    const results = await Promise.all(workers.map(readFinancialProcessResult));

    expect(
      results.filter((result) => result.status === 'PROCESSED'),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === 'REJECTED' &&
          result.failureCode === 'INSUFFICIENT_FUNDS',
      ),
    ).toHaveLength(2);
    expect(
      results.every(
        (result) =>
          (result.balance as { amount?: string } | undefined)?.amount ===
          '20.00',
      ),
    ).toBe(true);

    const reconciliation = await new ReconcileWalletUseCase(unitOfWork).execute(
      walletId,
    );
    expect(reconciliation).toEqual({
      walletId,
      storedBalance: { amount: '20.00', currency: 'BRL' },
      calculatedBalance: { amount: '20.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test('replays safely after a real consumer process dies between commit and ack', async () => {
    const walletId = '10000000-0000-4000-8000-000000000120';
    const playerId = '20000000-0000-4000-8000-000000000120';
    const messageId = 'message-process-recovery-120';
    const idempotencyKey = 'provider-process-recovery:bet-120';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000120',
        '40000000-0000-4000-8000-000000000120',
        '50000000-0000-4000-8000-000000000120',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-process-recovery-120',
    });

    const sqsClient = new SQSClient({
      endpoint: process.env.SQS_ENDPOINT ?? 'http://127.0.0.1:4566',
      region: process.env.AWS_REGION ?? 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
    });
    const queueName = `process-recovery-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}.fifo`;
    const queue = await sqsClient.send(
      new CreateQueueCommand({
        QueueName: queueName,
        Attributes: { FifoQueue: 'true', VisibilityTimeout: '1' },
      }),
    );
    if (queue.QueueUrl === undefined) {
      throw new Error('SQS did not return the process-recovery queue URL.');
    }
    const queueUrl = queue.QueueUrl;

    try {
      const body = JSON.stringify({
        messageId,
        type: 'WagerTransactionRequested',
        occurredAt: CREATED_AT.toISOString(),
        data: {
          providerId: 'provider-process-recovery',
          externalTransactionId: 'bet-120',
          idempotencyKey,
          playerId,
          walletId,
          roundId: 'round-process-recovery-120',
          gameId: 'game-process-recovery-120',
          kind: WagerTransactionKind.Bet,
          money: { amount: '25.00', currency: 'BRL' },
        },
      });
      await sqsClient.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: body,
          MessageGroupId: walletId,
          MessageDeduplicationId: messageId,
        }),
      );

      const crashingWorker = spawnSqsFinancialProcess('SQS_CRASH', queueUrl);
      const firstOutput = await waitForFinancialProcessSignal(
        crashingWorker,
        'PROCESSED:',
      );
      expect(firstOutput).toContain('"idempotentReplay":false');
      crashingWorker.kill();
      await crashingWorker.exited;

      const replacementWorker = spawnSqsFinancialProcess('SQS_ACK', queueUrl);
      const [exitCode, stdout, stderr] = await Promise.all([
        replacementWorker.exited,
        new Response(replacementWorker.stdout).text(),
        new Response(replacementWorker.stderr).text(),
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe('');
      expect(stdout).toContain('"idempotentReplay":true');
      expect(stdout).toContain('"receiveCount":"2"');
      expect(stdout).toContain('ACKED');

      const processedLine = stdout
        .split(/\r?\n/u)
        .find((line) => line.startsWith('PROCESSED:'));
      if (processedLine === undefined) {
        throw new Error('Replacement process returned no processing result.');
      }
      const replayResult = JSON.parse(
        processedLine.slice('PROCESSED:'.length),
      ) as { transactionId: string };
      const [counts] = await requiredApplicationOrm().em
        .getConnection()
        .execute<
          Array<{
            inbox_count: string;
            ledger_count: string;
            outbox_count: string;
            transaction_count: string;
          }>
        >(
          `select
             (select count(*)::text from wager_transactions where idempotency_key = ?) as transaction_count,
             (select count(*)::text from wallet_ledger_entries where transaction_id = ?) as ledger_count,
             (select count(*)::text from inbox_messages where consumer_name = 'wager-transactions-consumer' and message_id = ?) as inbox_count,
             (select count(*)::text from outbox_messages where payload -> 'data' ->> 'transactionId' = ?) as outbox_count`,
          [
            idempotencyKey,
            replayResult.transactionId,
            messageId,
            replayResult.transactionId,
          ],
        );
      expect(counts).toEqual({
        transaction_count: '1',
        ledger_count: '1',
        inbox_count: '1',
        outbox_count: '2',
      });
      expect(
        await new ReconcileWalletUseCase(unitOfWork).execute(walletId),
      ).toEqual({
        walletId,
        storedBalance: { amount: '75.00', currency: 'BRL' },
        calculatedBalance: { amount: '75.00', currency: 'BRL' },
        difference: { amount: '0.00', currency: 'BRL' },
        consistent: true,
        checkedEntries: 2,
      });
      const remaining = await sqsClient.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 1,
        }),
      );
      expect(remaining.Messages).toBeUndefined();
    } finally {
      await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
      sqsClient.destroy();
    }
  }, 25_000);

  test('applies every wagering rule atomically and keeps wallet equal to its ledger', async () => {
    const walletId = '10000000-0000-4000-8000-000000000112';
    const playerId = '20000000-0000-4000-8000-000000000112';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000112',
        '40000000-0000-4000-8000-000000000112',
        '50000000-0000-4000-8000-000000000112',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-112',
    });
    const useCase = createFinancialUseCase(requiredApplicationOrm());
    const submit = (
      externalTransactionId: string,
      kind: WagerTransactionKind,
      amount: string,
      referenceExternalTransactionId?: string,
    ) =>
      useCase.execute({
        providerId: 'provider-rules',
        externalTransactionId,
        idempotencyKey: `provider-rules:${externalTransactionId}`,
        playerId,
        walletId,
        roundId: 'round-rules-112',
        gameId: 'game-rules-112',
        kind,
        money: { amount, currency: 'BRL' },
        ...(referenceExternalTransactionId === undefined
          ? {}
          : { referenceExternalTransactionId }),
        correlationId: `correlation-${externalTransactionId}`,
      });

    const bet = await submit('bet-112', WagerTransactionKind.Bet, '25.00');
    const win = await submit('win-112', WagerTransactionKind.Win, '10.00');
    const loss = await submit('loss-112', WagerTransactionKind.Loss, '5.00');
    const refund = await submit(
      'refund-112',
      WagerTransactionKind.Refund,
      '25.00',
      'bet-112',
    );
    const rollback = await submit(
      'rollback-112',
      WagerTransactionKind.Rollback,
      '10.00',
      'win-112',
    );
    const duplicateRefund = await submit(
      'refund-duplicate-112',
      WagerTransactionKind.Refund,
      '25.00',
      'bet-112',
    );
    const pendingRollback = await submit(
      'rollback-pending-112',
      WagerTransactionKind.Rollback,
      '8.00',
      'missing-112',
    );

    expect([bet, win, loss, refund, rollback].map((result) => result.status)).toEqual(
      Array.from({ length: 5 }, () => WagerTransactionStatus.Processed),
    );
    expect([bet, win, loss, refund, rollback].map((result) => result.balance?.amount)).toEqual([
      '75.00',
      '85.00',
      '85.00',
      '110.00',
      '100.00',
    ]);
    expect(duplicateRefund).toMatchObject({
      status: WagerTransactionStatus.Rejected,
      balance: { amount: '100.00', currency: 'BRL' },
      failureCode: 'REFERENCE_ALREADY_REVERSED',
    });
    expect(pendingRollback).toMatchObject({
      status: WagerTransactionStatus.PendingReference,
      balance: { amount: '100.00', currency: 'BRL' },
    });

    const getById = new GetWagerTransactionByIdUseCase(unitOfWork);
    const getByProvider = new GetProviderWagerTransactionUseCase(unitOfWork);
    const betSnapshot = await getById.execute(bet.transactionId);
    expect(betSnapshot).toMatchObject({
      transactionId: bet.transactionId,
      providerId: 'provider-rules',
      externalTransactionId: 'bet-112',
      kind: WagerTransactionKind.Bet,
      status: WagerTransactionStatus.Processed,
      money: { amount: '25.00', currency: 'BRL' },
      balance: { amount: '75.00', currency: 'BRL' },
      createdAt: PROCESSED_AT.toISOString(),
      processedAt: PROCESSED_AT.toISOString(),
    });
    expect(
      await getByProvider.execute({
        providerId: 'provider-rules',
        externalTransactionId: 'bet-112',
      }),
    ).toEqual(betSnapshot);
    expect(await getById.execute(duplicateRefund.transactionId)).toMatchObject({
      status: WagerTransactionStatus.Rejected,
      failureCode: 'REFERENCE_ALREADY_REVERSED',
      balance: { amount: '100.00', currency: 'BRL' },
    });
    const pendingSnapshot = await getById.execute(
      pendingRollback.transactionId,
    );
    expect(pendingSnapshot).toMatchObject({
      status: WagerTransactionStatus.PendingReference,
      referenceExternalTransactionId: 'missing-112',
      balance: { amount: '100.00', currency: 'BRL' },
    });
    expect(pendingSnapshot).not.toHaveProperty('processedAt');

    expect(await new ReconcileWalletUseCase(unitOfWork).execute(walletId)).toEqual({
      walletId,
      storedBalance: { amount: '100.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 5,
    });
    await unitOfWork.execute(async (repositories) => {
      expect((await repositories.wallets.findById(walletId))?.version).toBe(5);
      expect(
        await repositories.walletLedgerEntries.listByWallet(walletId, {
          limit: 20,
        }),
      ).toHaveLength(5);
    });

    const eventCounts = await requiredApplicationOrm().em
      .getConnection()
      .execute<Array<{ event_type: string; count: string }>>(
        `select event_type, count(*)::text as count
           from outbox_messages
          where payload -> 'data' ->> 'walletId' = ?
          group by event_type
          order by event_type`,
        [walletId],
      );
    expect(eventCounts).toEqual([
      { event_type: 'WagerTransactionPendingReference', count: '1' },
      { event_type: 'WagerTransactionProcessed', count: '5' },
      { event_type: 'WagerTransactionRejected', count: '1' },
      { event_type: 'WalletBalanceChanged', count: '5' },
    ]);
  });

  test('allows only one of two concurrent 80.00 bets against a 100.00 wallet', async () => {
    const walletId = '10000000-0000-4000-8000-000000000113';
    const playerId = '20000000-0000-4000-8000-000000000113';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000113',
        '40000000-0000-4000-8000-000000000113',
        '50000000-0000-4000-8000-000000000113',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-113',
    });

    const instances = await Promise.all(
      Array.from({ length: 3 }, () => createIndependentApplicationOrm([])),
    );
    try {
      const first = instances[0];
      const second = instances[1];
      if (first === undefined || second === undefined) {
        throw new Error('Concurrent financial processors were not created');
      }
      const submissions = [
        ['bet-a-113', createFinancialUseCase(first)],
        ['bet-b-113', createFinancialUseCase(second)],
      ] as const;
      const results = await Promise.all(
        submissions.map(([externalTransactionId, useCase]) =>
          useCase.execute({
            providerId: 'provider-concurrency',
            externalTransactionId,
            idempotencyKey: `provider-concurrency:${externalTransactionId}`,
            playerId,
            walletId,
            roundId: 'round-concurrency-113',
            gameId: 'game-concurrency-113',
            kind: WagerTransactionKind.Bet,
            money: { amount: '80.00', currency: 'BRL' },
            correlationId: `correlation-${externalTransactionId}`,
          }),
        ),
      );

      expect(
        results.filter((result) => result.status === WagerTransactionStatus.Processed),
      ).toHaveLength(1);
      expect(
        results.filter(
          (result) =>
            result.status === WagerTransactionStatus.Rejected &&
            result.failureCode === 'INSUFFICIENT_FUNDS',
        ),
      ).toHaveLength(1);
      expect(results.every((result) => result.balance?.amount === '20.00')).toBe(true);
    } finally {
      await Promise.all(instances.map((orm) => orm.close(true)));
    }

    expect(await new ReconcileWalletUseCase(unitOfWork).execute(walletId)).toEqual({
      walletId,
      storedBalance: { amount: '20.00', currency: 'BRL' },
      calculatedBalance: { amount: '20.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test('rolls back wallet, ledger, transaction, and outbox when a wager flush fails', async () => {
    const walletId = '10000000-0000-4000-8000-000000000114';
    const playerId = '20000000-0000-4000-8000-000000000114';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000114',
        '40000000-0000-4000-8000-000000000114',
        '50000000-0000-4000-8000-000000000114',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-114',
    });
    const processor = new PersistentWagerTransactionProcessor(
      unitOfWork,
      new WagerTransactionExecutor(
        new SequenceIdGenerator([
          '30000000-0000-4000-8000-000000000214',
          '40000000-0000-4000-8000-000000000214',
          'invalid-outbox-id',
          '50000000-0000-4000-8000-000000000214',
        ]),
        new FixedClock(PROCESSED_AT),
        new PendingReferenceRetryPolicy(30, 3_600, 86_400),
      ),
      new MikroOrmPersistenceConflictClassifier(),
    );
    const useCase = new ProcessWagerTransactionUseCase(
      processor,
      new WagerPayloadFingerprintService(new Sha256PayloadDigest()),
    );
    queryLog.length = 0;

    let caught: unknown;
    try {
      await useCase.execute({
        providerId: 'provider-atomicity',
        externalTransactionId: 'bet-114',
        idempotencyKey: 'provider-atomicity:bet-114',
        playerId,
        walletId,
        roundId: 'round-atomicity-114',
        gameId: 'game-atomicity-114',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
        correlationId: 'correlation-bet-114',
        delivery: {
          consumerName: 'wager-transactions-consumer',
          messageId: 'message-114',
          payloadHash: 'sqs-payload-114',
          receivedAt: CREATED_AT,
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(postgresErrorDetails(caught).code).toBe('22P02');
    expect(queryLog.some((message) => message.includes('rollback'))).toBe(true);
    expect(await new ReconcileWalletUseCase(unitOfWork).execute(walletId)).toEqual({
      walletId,
      storedBalance: { amount: '100.00', currency: 'BRL' },
      calculatedBalance: { amount: '100.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    });
    await unitOfWork.execute(async (repositories) => {
      expect(
        await repositories.wagerTransactions.findByProviderTransaction(
          'provider-atomicity',
          'bet-114',
        ),
      ).toBeUndefined();
      expect((await repositories.wallets.findById(walletId))?.version).toBe(1);
      expect(
        await repositories.inboxMessages.findByIdentity(
          'wager-transactions-consumer',
          'message-114',
        ),
      ).toBeUndefined();
    });
  });

  test('commits inbox with financial effects and deduplicates SQS redelivery', async () => {
    const walletId = '10000000-0000-4000-8000-000000000115';
    const playerId = '20000000-0000-4000-8000-000000000115';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000115',
        '40000000-0000-4000-8000-000000000115',
        '50000000-0000-4000-8000-000000000115',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-115',
    });
    const useCase = createFinancialUseCase(requiredApplicationOrm());
    const submission = {
      providerId: 'provider-inbox',
      externalTransactionId: 'bet-115',
      idempotencyKey: 'provider-inbox:bet-115',
      playerId,
      walletId,
      roundId: 'round-inbox-115',
      gameId: 'game-inbox-115',
      kind: WagerTransactionKind.Bet,
      money: { amount: '25.00', currency: 'BRL' },
      correlationId: 'message-115',
      delivery: {
        consumerName: 'wager-transactions-consumer',
        messageId: 'message-115',
        payloadHash: 'sqs-payload-115',
        receivedAt: CREATED_AT,
      },
    } as const;

    const first = await useCase.execute(submission);
    const replay = await useCase.execute(submission);

    expect(first).toMatchObject({
      status: WagerTransactionStatus.Processed,
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    await expect(
      useCase.execute({
        ...submission,
        delivery: {
          ...submission.delivery,
          payloadHash: 'different-sqs-payload-115',
        },
      }),
    ).rejects.toBeInstanceOf(InboxPayloadConflictError);

    const [counts] = await requiredApplicationOrm().em
      .getConnection()
      .execute<
        Array<{
          inbox_count: string;
          ledger_count: string;
          outbox_count: string;
          transaction_count: string;
        }>
      >(
        `select
           (select count(*)::text from inbox_messages where consumer_name = ? and message_id = ?) as inbox_count,
           (select count(*)::text from wallet_ledger_entries where wallet_id = ? and transaction_id = ?) as ledger_count,
           (select count(*)::text from outbox_messages where payload -> 'data' ->> 'transactionId' = ?) as outbox_count,
           (select count(*)::text from wager_transactions where idempotency_key = ?) as transaction_count`,
        [
          submission.delivery.consumerName,
          submission.delivery.messageId,
          walletId,
          first.transactionId,
          first.transactionId,
          submission.idempotencyKey,
        ],
      );
    expect(counts).toEqual({
      inbox_count: '1',
      ledger_count: '1',
      outbox_count: '2',
      transaction_count: '1',
    });
    await unitOfWork.execute(async (repositories) => {
      const inbox = await repositories.inboxMessages.findByIdentity(
        submission.delivery.consumerName,
        submission.delivery.messageId,
      );
      expect(inbox?.isProcessed()).toBe(true);
      expect(inbox?.processedAt?.toISOString()).toBe(CREATED_AT.toISOString());
    });
    expect(await new ReconcileWalletUseCase(unitOfWork).execute(walletId)).toEqual({
      walletId,
      storedBalance: { amount: '75.00', currency: 'BRL' },
      calculatedBalance: { amount: '75.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test('returns one 409 conflict when provider identity races under different idempotency keys', async () => {
    const walletId = '10000000-0000-4000-8000-000000000118';
    const playerId = '20000000-0000-4000-8000-000000000118';
    const providerId = 'provider-external-conflict';
    const externalTransactionId = 'external-conflict-118';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([walletId]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '0.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-118',
    });

    const executor = new ConcurrentLossExecutor(
      2,
      'ProviderIdentityProbeProcessed',
    );
    const useCase = new ProcessWagerTransactionUseCase(
      new PersistentWagerTransactionProcessor(
        unitOfWork,
        executor,
        new MikroOrmPersistenceConflictClassifier(),
      ),
      new WagerPayloadFingerprintService(new Sha256PayloadDigest()),
    );
    const submission = {
      providerId,
      externalTransactionId,
      playerId,
      walletId,
      roundId: 'round-provider-conflict-118',
      gameId: 'game-provider-conflict-118',
      kind: WagerTransactionKind.Loss,
      money: { amount: '10.00', currency: 'BRL' },
    } as const;

    const results = await Promise.allSettled([
      useCase.execute({
        ...submission,
        idempotencyKey: 'provider-conflict-key-a',
        correlationId: 'provider-conflict-correlation-a',
      }),
      useCase.execute({
        ...submission,
        idempotencyKey: 'provider-conflict-key-b',
        correlationId: 'provider-conflict-correlation-b',
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0]?.status !== 'rejected') {
      throw new Error('Expected one provider transaction submission to fail');
    }
    expect(rejected[0].reason).toBeInstanceOf(
      ProviderTransactionConflictError,
    );
    expect(mapHttpError(rejected[0].reason)).toEqual(
      expect.objectContaining({
        status: 409,
        body: expect.objectContaining({
          statusCode: 409,
          code: 'PROVIDER_TRANSACTION_CONFLICT',
        }),
      }),
    );

    const [counts] = await requiredApplicationOrm().em
      .getConnection()
      .execute<Array<{ outbox_count: string; transaction_count: string }>>(
        `select
           (select count(*)::text
              from wager_transactions
             where provider_id = ? and external_transaction_id = ?) as transaction_count,
           (select count(*)::text
              from outbox_messages
             where event_type = 'ProviderIdentityProbeProcessed') as outbox_count`,
        [providerId, externalTransactionId],
      );
    expect(counts).toEqual({ transaction_count: '1', outbox_count: '1' });
    expect(
      await new ReconcileWalletUseCase(unitOfWork).execute(walletId),
    ).toEqual({
      walletId,
      storedBalance: { amount: '0.00', currency: 'BRL' },
      calculatedBalance: { amount: '0.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 0,
    });
  });

  test('deduplicates 50 concurrent bets into one debit and one ledger effect', async () => {
    const walletId = '10000000-0000-4000-8000-000000000109';
    const playerId = '20000000-0000-4000-8000-000000000109';
    const idempotencyKey = 'provider-idempotency:external-109';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    await createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([
        walletId,
        '30000000-0000-4000-8000-000000000109',
        '40000000-0000-4000-8000-000000000109',
        '50000000-0000-4000-8000-000000000109',
      ]),
      new FixedClock(CREATED_AT),
    ).execute({
      playerId,
      initialBalance: { amount: '100.00', currency: 'BRL' },
      correlationId: 'wallet-create-integration-109',
    });

    const barrier = new PublicationBarrier(3);
    const contendedUnitOfWork = synchronizeMissingIdempotencyLookup(
      unitOfWork,
      barrier,
    );
    const processor = new PersistentWagerTransactionProcessor(
      contendedUnitOfWork,
      new WagerTransactionExecutor(
        new UuidGenerator(),
        new FixedClock(PROCESSED_AT),
        new PendingReferenceRetryPolicy(30, 3_600, 86_400),
      ),
      new MikroOrmPersistenceConflictClassifier(),
    );
    const useCase = new ProcessWagerTransactionUseCase(
      processor,
      new WagerPayloadFingerprintService(new Sha256PayloadDigest()),
    );
    const submission = {
      providerId: 'provider-idempotency',
      externalTransactionId: 'external-109',
      idempotencyKey,
      playerId,
      walletId,
      roundId: 'round-109',
      gameId: 'game-109',
      kind: WagerTransactionKind.Bet,
      money: { amount: '10.00', currency: 'BRL' },
      correlationId: 'correlation-109',
    } as const;

    const results = await Promise.all(
      Array.from({ length: 50 }, () => useCase.execute(submission)),
    );
    const transactionIds = new Set(
      results.map((result) => result.transactionId),
    );

    expect(transactionIds.size).toBe(1);
    expect(
      results.filter((result) => !result.idempotentReplay),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.idempotentReplay),
    ).toHaveLength(49);
    expect(
      results.every(
        (result) =>
          result.status === WagerTransactionStatus.Processed &&
          result.balance?.amount === '90.00' &&
          result.balance.currency === 'BRL',
      ),
    ).toBe(true);
    expect(barrier.arrivalCount).toBeGreaterThanOrEqual(3);
    const committedTransactionId = results[0]?.transactionId;
    if (committedTransactionId === undefined) {
      throw new Error('Concurrent submissions returned no result');
    }

    const replay = await useCase.execute({
      ...submission,
      correlationId: 'another-correlation',
    });
    expect(replay).toEqual({
      transactionId: committedTransactionId,
      status: WagerTransactionStatus.Processed,
      balance: { amount: '90.00', currency: 'BRL' },
      idempotentReplay: true,
    });
    await expect(
      useCase.execute({
        ...submission,
        money: { amount: '11.00', currency: 'BRL' },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);

    const [counts] = await requiredApplicationOrm().em
      .getConnection()
      .execute<
        Array<{
          balance_event_count: string;
          ledger_count: string;
          processed_event_count: string;
          transaction_count: string;
        }>
      >(
        `select
           (select count(*)::text
              from wager_transactions
             where idempotency_key = ?) as transaction_count,
           (select count(*)::text
              from wallet_ledger_entries
             where transaction_id = ?) as ledger_count,
           (select count(*)::text
              from outbox_messages
             where event_type = 'WagerTransactionProcessed'
               and payload -> 'data' ->> 'transactionId' = ?) as processed_event_count,
           (select count(*)::text
              from outbox_messages
             where event_type = 'WalletBalanceChanged'
               and payload -> 'data' ->> 'transactionId' = ?) as balance_event_count`,
        [
          idempotencyKey,
          committedTransactionId,
          committedTransactionId,
          committedTransactionId,
        ],
      );
    expect(counts).toEqual({
      transaction_count: '1',
      ledger_count: '1',
      processed_event_count: '1',
      balance_event_count: '1',
    });
    expect(await new ReconcileWalletUseCase(unitOfWork).execute(walletId)).toEqual({
      walletId,
      storedBalance: { amount: '90.00', currency: 'BRL' },
      calculatedBalance: { amount: '90.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
  });

  test('rolls back every wallet-opening effect when its transaction cannot persist', async () => {
    const walletId = '10000000-0000-4000-8000-000000000106';
    const playerId = '20000000-0000-4000-8000-000000000106';
    const ledgerId = '40000000-0000-4000-8000-000000000106';
    const eventId = '50000000-0000-4000-8000-000000000106';
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    const useCase = createWalletUseCase(
      unitOfWork,
      new SequenceIdGenerator([walletId, 'invalid-opening-id', ledgerId, eventId]),
      new FixedClock(CREATED_AT),
    );
    queryLog.length = 0;

    let caught: unknown;
    try {
      await useCase.execute({
        playerId,
        initialBalance: { amount: '50.00', currency: 'BRL' },
        correlationId: 'wallet-create-integration-106',
      });
    } catch (error) {
      caught = error;
    }

    expect(postgresErrorDetails(caught).code).toBe('22P02');
    expect(
      queryLog.some((message) => message.includes('insert into "wallets"')),
    ).toBe(true);
    expect(queryLog.some((message) => message.includes('rollback'))).toBe(true);

    await unitOfWork.execute(async (repositories) => {
      expect(await repositories.wallets.findById(walletId)).toBeUndefined();
      expect(await repositories.outboxMessages.findById(eventId)).toBeUndefined();
    });
  });

  test('rejects critical uniqueness, nonnegative and immutability violations', async () => {
    const connection = requiredApplicationOrm().em.getConnection();

    await expectPostgreSqlError(
      () =>
        connection.execute(
          `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
           values (?, ?, 'BRL', '10.00', 1, ?, ?)`,
          [
            '10000000-0000-4000-8000-000000000102',
            PLAYER_ID,
            CREATED_AT,
            CREATED_AT,
          ],
        ),
      '23505',
      'wallets_player_id_currency_unique',
    );
    await expectPostgreSqlError(
      () =>
        connection.execute(
          `insert into wallets (id, player_id, currency, balance, version, created_at, updated_at)
           values (?, ?, 'BRL', '-0.01', 1, ?, ?)`,
          [
            '10000000-0000-4000-8000-000000000103',
            '20000000-0000-4000-8000-000000000103',
            CREATED_AT,
            CREATED_AT,
          ],
        ),
      '23514',
      'wallets_balance_nonnegative_check',
    );
    await expectPostgreSqlError(
      () =>
        connection.execute(
          `insert into wager_transactions (
             id, provider_id, external_transaction_id, idempotency_key, payload_hash,
             wallet_id, player_id, round_id, game_id, kind, status, amount, currency,
             reference_attempts, created_at
           ) values (?, 'provider-a', 'external-duplicate-key', ?, 'payload-hash', ?, ?,
                     'round-1', 'game-1', 'BET', 'PENDING', '1.00', 'BRL', 0, ?)`,
          [
            '30000000-0000-4000-8000-000000000102',
            `opening:${WALLET_ID}`,
            WALLET_ID,
            PLAYER_ID,
            CREATED_AT,
          ],
        ),
      '23505',
      'wager_transactions_idempotency_key_unique',
    );
    await expectPostgreSqlError(
      () =>
        connection.execute(
          `insert into inbox_messages (consumer_name, message_id, payload_hash, received_at)
           values ('postgres-integration-test', 'opening-message', 'other-hash', ?)`,
          [CREATED_AT],
        ),
      '23505',
      'inbox_messages_pkey',
    );
    await expectPostgreSqlError(
      () =>
        connection.execute(
          `insert into outbox_messages (
             id, aggregate_id, event_type, payload, occurred_at, attempts
           ) values (?, ?, 'invalid.retry.v1', '{}'::jsonb, ?, -1)`,
          [
            '50000000-0000-4000-8000-000000000102',
            WALLET_ID,
            CREATED_AT,
          ],
        ),
      '23514',
      'outbox_messages_attempts_nonnegative_check',
    );
    await expectPostgreSqlError(
      () =>
        connection.execute(
          'update wallet_ledger_entries set balance_after = balance_after + 1 where id = ?',
          [OPENING_LEDGER_ID],
        ),
      '55000',
    );
    await expectPostgreSqlError(
      () =>
        connection.execute('delete from wallet_ledger_entries where id = ?', [
          OPENING_LEDGER_ID,
        ]),
      '55000',
    );
  });

  test('rolls back executed writes when the Unit of Work flush fails', async () => {
    const unitOfWork = new MikroOrmUnitOfWork(requiredApplicationOrm());
    const rollbackWalletId = '10000000-0000-4000-8000-000000000104';
    const rollbackPlayerId = '20000000-0000-4000-8000-000000000104';
    const wallet = Wallet.open({
      id: rollbackWalletId,
      playerId: rollbackPlayerId,
      initialBalance: money('0.00'),
      openedAt: CREATED_AT,
    });
    const rollbackTransactionId = '30000000-0000-4000-8000-000000000104';
    const rollbackTransaction = WagerTransaction.create({
      id: rollbackTransactionId,
      providerId: 'rollback-probe',
      externalTransactionId: 'rollback-probe-transaction',
      idempotencyKey: 'rollback-probe:transaction',
      payloadHash: 'rollback-probe-payload',
      walletId: rollbackWalletId,
      playerId: rollbackPlayerId,
      roundId: 'rollback-probe-round',
      gameId: 'rollback-probe-game',
      kind: WagerTransactionKind.Bet,
      money: money('1.00'),
      createdAt: CREATED_AT,
    });
    queryLog.length = 0;

    let caught: unknown;
    try {
      await unitOfWork.execute(async (repositories) => {
        await repositories.wallets.add(wallet);
        await repositories.wagerTransactions.add({
          transaction: rollbackTransaction,
          referenceAttempts: -1,
        });
      });
    } catch (error) {
      caught = error;
    }

    expect(postgresErrorDetails(caught)).toEqual(
      expect.objectContaining({
        code: '23514',
        constraint: 'wager_transactions_reference_attempts_check',
      }),
    );
    expect(
      queryLog.some((message) => message.includes('insert into "wallets"')),
    ).toBe(true);
    expect(
      queryLog.some((message) => message.includes('insert into "wager_transactions"')),
    ).toBe(true);
    expect(queryLog.some((message) => message.includes('rollback'))).toBe(true);

    await unitOfWork.execute(async (repositories) => {
      expect(await repositories.wallets.findById(rollbackWalletId)).toBeUndefined();
      expect(
        await repositories.wagerTransactions.findById(rollbackTransactionId),
      ).toBeUndefined();
    });
  });

  test('reverts every migration and reapplies the complete schema', async () => {
    await migrateDownCompletely();

    expect(await requiredApplicationOrm().migrator.getExecuted()).toHaveLength(
      0,
    );
    expect(await applicationTableNames()).toEqual([]);

    await requiredApplicationOrm().migrator.up();

    expect(await applicationTableNames()).toEqual([...APPLICATION_TABLES]);
    expect(
      await requiredApplicationOrm().migrator.getExecuted(),
    ).toHaveLength(4);
  });
});
