import { Logger, type LoggerService } from '@nestjs/common';

import type {
  OperationalLogContext,
  OperationalLogger,
} from '../../application/ports/operational-logger.js';

export class NestOperationalLogger implements OperationalLogger {
  constructor(
    private readonly sink: Pick<LoggerService, 'log' | 'warn' | 'error'> =
      new Logger('Operations'),
  ) {}

  info(event: string, context: OperationalLogContext): void {
    this.sink.log({ event, ...context });
  }

  warn(event: string, context: OperationalLogContext): void {
    this.sink.warn({ event, ...context });
  }

  error(event: string, context: OperationalLogContext): void {
    this.sink.error({ event, ...context });
  }
}
