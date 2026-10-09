import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import type { Clock } from '../application/ports/clock.js';
import { CLOCK } from '../application/ports/clock.js';
import type { UnitOfWork } from '../application/ports/persistence/unit-of-work.js';
import { PERSISTENCE_UNIT_OF_WORK } from '../application/ports/persistence/unit-of-work.js';
import { WagerTransactionExecutor } from '../application/services/wager-transaction.executor.js';
import { ProcessPendingReferencesBatchUseCase } from '../application/use-cases/wagering/process-pending-references-batch.use-case.js';
import type { EnvironmentVariables } from '../config/environment.schema.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';
import { PendingReferenceWorker } from '../interfaces/workers/pending-reference.worker.js';
import { WageringApplicationModule } from './wagering-application.module.js';

@Module({
  imports: [ConfigModule, PersistenceModule, WageringApplicationModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: ProcessPendingReferencesBatchUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK, WagerTransactionExecutor, CLOCK],
      useFactory: (
        unitOfWork: UnitOfWork,
        executor: WagerTransactionExecutor,
        clock: Clock,
      ) =>
        new ProcessPendingReferencesBatchUseCase(
          unitOfWork,
          executor,
          clock,
        ),
    },
    PendingReferenceWorker,
  ],
})
export class PendingReferenceWorkerModule {}
