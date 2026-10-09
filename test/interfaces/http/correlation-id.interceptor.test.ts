import { describe, expect, mock, test } from 'bun:test';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { CorrelationIdInterceptor } from '../../../src/interfaces/http/correlation-id.interceptor.js';

describe('CorrelationIdInterceptor', () => {
  test('generates one correlation id shared by the request and response', async () => {
    const headers: Record<string, unknown> = {};
    const setHeader = mock(() => undefined);
    const handle = mock(() => of('handled'));
    const interceptor = new CorrelationIdInterceptor();

    const result = await firstValueFrom(
      interceptor.intercept(
        executionContext(headers, setHeader),
        { handle } as CallHandler,
      ),
    );

    const correlationId = headers['x-correlation-id'];
    expect(correlationId).toBeString();
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', correlationId);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(result).toBe('handled');
  });

  test('preserves a valid caller-provided correlation id', () => {
    const headers: Record<string, unknown> = {
      'x-correlation-id': 'provider-request-42',
    };
    const setHeader = mock(() => undefined);
    const interceptor = new CorrelationIdInterceptor();

    interceptor.intercept(
      executionContext(headers, setHeader),
      { handle: () => of(undefined) } as CallHandler,
    );

    expect(headers['x-correlation-id']).toBe('provider-request-42');
    expect(setHeader).toHaveBeenCalledWith(
      'x-correlation-id',
      'provider-request-42',
    );
  });

  test('rejects a blank caller-provided correlation id', () => {
    const interceptor = new CorrelationIdInterceptor();

    expect(() =>
      interceptor.intercept(
        executionContext({ 'x-correlation-id': '   ' }, () => undefined),
        { handle: () => of(undefined) } as CallHandler,
      ),
    ).toThrow();
  });
});

function executionContext(
  headers: Record<string, unknown>,
  setHeader: (name: string, value: string) => void,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
      getResponse: () => ({ setHeader }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}
