import { Global, Module } from '@nestjs/common';

import { OPERATIONAL_LOGGER } from '../application/ports/operational-logger.js';
import { NestOperationalLogger } from '../infrastructure/observability/nest-operational.logger.js';

@Global()
@Module({
  providers: [
    {
      provide: OPERATIONAL_LOGGER,
      useFactory: () => new NestOperationalLogger(),
    },
  ],
  exports: [OPERATIONAL_LOGGER],
})
export class ObservabilityModule {}
