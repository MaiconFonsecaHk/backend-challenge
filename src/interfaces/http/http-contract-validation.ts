import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

export const INVALID_HTTP_CONTRACT = 'INVALID_HTTP_CONTRACT';

export interface HttpContractIssue {
  readonly path: string;
  readonly message: string;
}

export function parseHttpContract<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) =>
    Object.freeze({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }),
  );

  throw new BadRequestException({
    code: INVALID_HTTP_CONTRACT,
    message: 'The request does not match the expected HTTP contract.',
    retryable: false,
    issues,
  });
}
