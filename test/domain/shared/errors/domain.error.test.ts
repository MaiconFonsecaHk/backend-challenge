import { expect, test } from 'bun:test';

import { DomainError } from '../../../../src/domain/shared/errors/domain.error.js';

class ExampleDomainError extends DomainError {
  readonly code = 'EXAMPLE_ERROR';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

test('preserves a stable code, concrete name, message, and cause', () => {
  const cause = new Error('original cause');
  const error = new ExampleDomainError('business rule failed', { cause });

  expect(error).toMatchObject({
    cause,
    code: 'EXAMPLE_ERROR',
    message: 'business rule failed',
    name: 'ExampleDomainError',
  });
});
