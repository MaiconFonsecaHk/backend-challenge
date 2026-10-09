import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, Inject } from '@nestjs/common';

import {
  OPERATIONAL_LOGGER,
  NOOP_OPERATIONAL_LOGGER,
  type OperationalLogger,
} from '../../application/ports/operational-logger.js';
import { mapHttpError } from './http-error-mapper.js';

interface HttpResponseAdapter {
  status(statusCode: number): HttpResponseAdapter;
  json(body: unknown): void;
}

interface HttpRequestAdapter {
  readonly headers: Record<string, unknown>;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(OPERATIONAL_LOGGER)
    private readonly logger: OperationalLogger = NOOP_OPERATIONAL_LOGGER,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<HttpResponseAdapter>();
    const request = http.getRequest<HttpRequestAdapter>();
    const mapped = mapHttpError(exception);

    const correlationId = request.headers['x-correlation-id'];
    const logContext = {
      ...(typeof correlationId === 'string' && correlationId.trim().length > 0
        ? { correlationId }
        : {}),
      statusCode: mapped.status,
      retryable: mapped.body.retryable,
      failureCode: mapped.body.code,
      errorType:
        exception instanceof Error ? exception.constructor.name : 'UnknownError',
    } as const;
    if (mapped.status >= 500) {
      this.logger.error('http.request.failed', logContext);
    } else {
      this.logger.warn('http.request.failed', logContext);
    }

    response.status(mapped.status).json(mapped.body);
  }
}
