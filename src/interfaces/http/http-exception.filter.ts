import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch } from '@nestjs/common';

import { mapHttpError } from './http-error-mapper.js';

interface HttpResponseAdapter {
  status(statusCode: number): HttpResponseAdapter;
  json(body: unknown): void;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponseAdapter>();
    const mapped = mapHttpError(exception);

    response.status(mapped.status).json(mapped.body);
  }
}
