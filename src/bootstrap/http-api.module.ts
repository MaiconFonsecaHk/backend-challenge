import { Module } from '@nestjs/common';

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
})
export class HttpApiModule {}
