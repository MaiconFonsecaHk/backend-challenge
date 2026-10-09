import { describe, expect, test } from 'bun:test';

import { UuidGenerator } from '../../../src/infrastructure/identity/uuid-generator.js';

describe('UuidGenerator', () => {
  test('generates distinct RFC 4122 version 4 identifiers', () => {
    const generator = new UuidGenerator();
    const first = generator.generate();
    const second = generator.generate();

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(second).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(second).not.toBe(first);
  });
});
