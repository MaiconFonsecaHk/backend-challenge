import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';

import { resolveCorrelationId } from './correlation-id.js';

interface CorrelatedHttpRequest {
  readonly headers: Record<string, unknown>;
}

interface CorrelatedHttpResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<CorrelatedHttpRequest>();
    const response = http.getResponse<CorrelatedHttpResponse>();
    const correlationId = resolveCorrelationId(
      request.headers['x-correlation-id'],
    );

    request.headers['x-correlation-id'] = correlationId;
    response.setHeader('x-correlation-id', correlationId);
    return next.handle();
  }
}
