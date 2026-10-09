import 'reflect-metadata';

import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './bootstrap/app.module.js';
import type { EnvironmentVariables } from './config/environment.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new ConsoleLogger({ colors: false, json: true }),
  });
  app.enableShutdownHooks();

  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const port = config.get('PORT', { infer: true });

  await app.listen(port);
}

await bootstrap();
