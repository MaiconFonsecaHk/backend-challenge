import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import type { Clock } from '../application/ports/clock.js';
import { CLOCK } from '../application/ports/clock.js';
import {
  OPERATIONAL_METRICS,
  type OperationalMetrics,
} from '../application/ports/operational-metrics.js';
import type { IdGenerator } from '../application/ports/id-generator.js';
import { ID_GENERATOR } from '../application/ports/id-generator.js';
import type { UnitOfWork } from '../application/ports/persistence/unit-of-work.js';
import { PERSISTENCE_UNIT_OF_WORK } from '../application/ports/persistence/unit-of-work.js';
import {
  WAGER_TRANSACTION_PROCESSOR,
  type WagerTransactionProcessor,
} from '../application/ports/wager-transaction-processor.js';
import { PersistentWagerTransactionProcessor } from '../application/services/persistent-wager-transaction.processor.js';
import { PendingReferenceRetryPolicy } from '../application/services/pending-reference-retry.policy.js';
import { WagerPayloadFingerprintService } from '../application/services/wager-payload-fingerprint.js';
import { WagerTransactionExecutor } from '../application/services/wager-transaction.executor.js';
import {
  GetProviderWagerTransactionUseCase,
  GetWagerTransactionByIdUseCase,
} from '../application/use-cases/wagering/get-wager-transaction.use-cases.js';
import { ProcessWagerTransactionUseCase } from '../application/use-cases/wagering/process-wager-transaction.use-case.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { Sha256PayloadDigest } from '../infrastructure/cryptography/sha256-payload-digest.js';
import { UuidGenerator } from '../infrastructure/identity/uuid-generator.js';
import { MikroOrmPersistenceConflictClassifier } from '../infrastructure/persistence/mikro-orm-persistence-conflict.classifier.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';

@Module({
  imports: [ConfigModule, PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    Sha256PayloadDigest,
    MikroOrmPersistenceConflictClassifier,
    {
      provide: PendingReferenceRetryPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new PendingReferenceRetryPolicy(
          config.get('PENDING_REFERENCE_RETRY_BASE_SECONDS', { infer: true }),
          config.get('PENDING_REFERENCE_RETRY_MAX_SECONDS', { infer: true }),
          config.get('PENDING_REFERENCE_TTL_SECONDS', { infer: true }),
        ),
    },
    {
      provide: WagerTransactionExecutor,
      inject: [ID_GENERATOR, CLOCK, PendingReferenceRetryPolicy],
      useFactory: (
        idGenerator: IdGenerator,
        clock: Clock,
        retryPolicy: PendingReferenceRetryPolicy,
      ) => new WagerTransactionExecutor(idGenerator, clock, retryPolicy),
    },
    {
      provide: WAGER_TRANSACTION_PROCESSOR,
      inject: [
        PERSISTENCE_UNIT_OF_WORK,
        WagerTransactionExecutor,
        MikroOrmPersistenceConflictClassifier,
        OPERATIONAL_METRICS,
      ],
      useFactory: (
        unitOfWork: UnitOfWork,
        executor: WagerTransactionExecutor,
        conflictClassifier: MikroOrmPersistenceConflictClassifier,
        metrics: OperationalMetrics,
      ) =>
        new PersistentWagerTransactionProcessor(
          unitOfWork,
          executor,
          conflictClassifier,
          metrics,
        ),
    },
    {
      provide: WagerPayloadFingerprintService,
      inject: [Sha256PayloadDigest],
      useFactory: (digest: Sha256PayloadDigest) =>
        new WagerPayloadFingerprintService(digest),
    },
    {
      provide: ProcessWagerTransactionUseCase,
      inject: [
        WAGER_TRANSACTION_PROCESSOR,
        WagerPayloadFingerprintService,
        OPERATIONAL_METRICS,
      ],
      useFactory: (
        processor: WagerTransactionProcessor,
        payloadFingerprint: WagerPayloadFingerprintService,
        metrics: OperationalMetrics,
      ) =>
        new ProcessWagerTransactionUseCase(
          processor,
          payloadFingerprint,
          metrics,
        ),
    },
    {
      provide: GetWagerTransactionByIdUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) =>
        new GetWagerTransactionByIdUseCase(unitOfWork),
    },
    {
      provide: GetProviderWagerTransactionUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) =>
        new GetProviderWagerTransactionUseCase(unitOfWork),
    },
  ],
  exports: [
    WagerTransactionExecutor,
    ProcessWagerTransactionUseCase,
    GetWagerTransactionByIdUseCase,
    GetProviderWagerTransactionUseCase,
  ],
})
export class WageringApplicationModule {}
