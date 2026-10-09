import { randomUUID } from 'node:crypto';

import { correlationIdHeaderSchema } from './http-contracts.js';
import { parseHttpContract } from './http-contract-validation.js';

export function resolveCorrelationId(headerValue: unknown): string {
  if (headerValue === undefined) {
    return randomUUID();
  }

  return parseHttpContract(correlationIdHeaderSchema, headerValue);
}
