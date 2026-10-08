import { Module } from '@nestjs/common';

import type { Clock } from '../application/ports/clock.js';
import { CLOCK } from '../application/ports/clock.js';
import type { IdGenerator } from '../application/ports/id-generator.js';
import { ID_GENERATOR } from '../application/ports/id-generator.js';
import type { UnitOfWork } from '../application/ports/persistence/unit-of-work.js';
import { PERSISTENCE_UNIT_OF_WORK } from '../application/ports/persistence/unit-of-work.js';
import { CreateWalletUseCase } from '../application/use-cases/wallet/create-wallet.use-case.js';
import { UuidGenerator } from '../infrastructure/identity/uuid-generator.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';

@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    {
      provide: CreateWalletUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK, ID_GENERATOR, CLOCK],
      useFactory: (
        unitOfWork: UnitOfWork,
        idGenerator: IdGenerator,
        clock: Clock,
      ) => new CreateWalletUseCase(unitOfWork, idGenerator, clock),
    },
  ],
  exports: [CreateWalletUseCase],
})
export class WalletApplicationModule {}
