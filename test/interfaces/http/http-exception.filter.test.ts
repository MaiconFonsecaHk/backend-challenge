import { describe, expect, mock, test } from 'bun:test';
import type { ArgumentsHost } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';

import type { OperationalLogger } from '../../../src/application/ports/operational-logger.js';
import { HttpExceptionFilter } from '../../../src/interfaces/http/http-exception.filter.js';

describe('HttpExceptionFilter operational logs', () => {
  test('records an expected client failure as a warning without raw details', () => {
    const warn = mock(() => undefined);
    const error = mock(() => undefined);
    const response = responseDouble();
    const filter = new HttpExceptionFilter(operationalLogger({ warn, error }));

    filter.catch(
      new BadRequestException({
        code: 'INVALID_HTTP_CONTRACT',
        message: 'secret body value',
        retryable: false,
      }),
      host(response, 'correlation-901'),
    );

    expect(warn).toHaveBeenCalledWith('http.request.failed', {
      correlationId: 'correlation-901',
      statusCode: 400,
      retryable: false,
      failureCode: 'INVALID_HTTP_CONTRACT',
      errorType: 'BadRequestException',
    });
    expect(error).toHaveBeenCalledTimes(0);
    expect(JSON.stringify(warn.mock.calls[0])).not.toContain('secret body value');
  });

  test('records an unexpected server failure as an error without its message', () => {
    const error = mock(() => undefined);
    const response = responseDouble();
    const filter = new HttpExceptionFilter(operationalLogger({ error }));

    filter.catch(
      new Error('database password leaked here'),
      host(response, 'correlation-902'),
    );

    expect(error).toHaveBeenCalledWith('http.request.failed', {
      correlationId: 'correlation-902',
      statusCode: 500,
      retryable: false,
      failureCode: 'INTERNAL_ERROR',
      errorType: 'Error',
    });
    expect(JSON.stringify(error.mock.calls[0])).not.toContain(
      'database password leaked here',
    );
  });
});

function responseDouble() {
  const response = {
    status: mock(() => response),
    json: mock(() => undefined),
  };
  return response;
}

function host(
  response: ReturnType<typeof responseDouble>,
  correlationId: string,
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        headers: { 'x-correlation-id': correlationId },
      }),
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
}

function operationalLogger(overrides: Partial<OperationalLogger> = {}): OperationalLogger {
  return {
    info: overrides.info ?? (() => undefined),
    warn: overrides.warn ?? (() => undefined),
    error: overrides.error ?? (() => undefined),
  };
}
