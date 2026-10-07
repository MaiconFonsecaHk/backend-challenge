import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { environmentSchema } from '../config/environment.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      skipProcessEnv: true,
      validationSchema: environmentSchema,
    }),
  ],
})
export class AppModule {}
