import { Module } from '@nestjs/common';

import type { Clock } from '../application/ports/clock.js';
import { CLOCK } from '../application/ports/clock.js';
import type { IdGenerator } from '../application/ports/id-generator.js';
import { ID_GENERATOR } from '../application/ports/id-generator.js';
import type { LedgerCursorCodec } from '../application/ports/ledger-cursor-codec.js';
import { LEDGER_CURSOR_CODEC } from '../application/ports/ledger-cursor-codec.js';
import type { UnitOfWork } from '../application/ports/persistence/unit-of-work.js';
import { PERSISTENCE_UNIT_OF_WORK } from '../application/ports/persistence/unit-of-work.js';
import { CreateWalletUseCase } from '../application/use-cases/wallet/create-wallet.use-case.js';
import { GetWalletLedgerUseCase } from '../application/use-cases/wallet/get-wallet-ledger.use-case.js';
import { GetWalletUseCase } from '../application/use-cases/wallet/get-wallet.use-case.js';
import { ReconcileWalletUseCase } from '../application/use-cases/wallet/reconcile-wallet.use-case.js';
import { UuidGenerator } from '../infrastructure/identity/uuid-generator.js';
import { PersistenceModule } from '../infrastructure/persistence/persistence.module.js';
import { Base64UrlLedgerCursorCodec } from '../infrastructure/serialization/base64url-ledger-cursor.codec.js';
import { SystemClock } from '../infrastructure/time/system-clock.js';

@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: UuidGenerator },
    { provide: LEDGER_CURSOR_CODEC, useClass: Base64UrlLedgerCursorCodec },
    {
      provide: CreateWalletUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK, ID_GENERATOR, CLOCK],
      useFactory: (
        unitOfWork: UnitOfWork,
        idGenerator: IdGenerator,
        clock: Clock,
      ) => new CreateWalletUseCase(unitOfWork, idGenerator, clock),
    },
    {
      provide: GetWalletUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) =>
        new GetWalletUseCase(unitOfWork),
    },
    {
      provide: GetWalletLedgerUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK, LEDGER_CURSOR_CODEC],
      useFactory: (
        unitOfWork: UnitOfWork,
        cursorCodec: LedgerCursorCodec,
      ) => new GetWalletLedgerUseCase(unitOfWork, cursorCodec),
    },
    {
      provide: ReconcileWalletUseCase,
      inject: [PERSISTENCE_UNIT_OF_WORK],
      useFactory: (unitOfWork: UnitOfWork) =>
        new ReconcileWalletUseCase(unitOfWork),
    },
  ],
  exports: [
    CreateWalletUseCase,
    GetWalletUseCase,
    GetWalletLedgerUseCase,
    ReconcileWalletUseCase,
  ],
})
export class WalletApplicationModule {}
