import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { HttpExceptionFilter } from '../interfaces/http/http-exception.filter.js';
import { DeferredProviderAuthenticationGuard } from '../interfaces/http/deferred-provider-auth.guard.js';
import {
  ProviderWageringController,
  WageringController,
} from '../interfaces/http/wagering.controller.js';
import { WalletController } from '../interfaces/http/wallet.controller.js';
import { WageringApplicationModule } from './wagering-application.module.js';
import { WalletApplicationModule } from './wallet-application.module.js';

@Module({
  imports: [WalletApplicationModule, WageringApplicationModule],
  controllers: [WalletController, WageringController, ProviderWageringController],
  providers: [
    DeferredProviderAuthenticationGuard,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class HttpApiModule {}
