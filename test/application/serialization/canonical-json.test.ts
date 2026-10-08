import { describe, expect, test } from 'bun:test';

import {
  serializeCanonicalJson,
  type CanonicalJsonValue,
} from '../../../src/application/serialization/canonical-json.js';

describe('serializeCanonicalJson', () => {
  test('sorts object keys recursively while preserving array order', () => {
    expect(
      serializeCanonicalJson({
        zeta: [{ second: 'two', first: 'one' }, 'line\nbreak'],
        alpha: { beta: true, alpha: null },
      }),
    ).toBe(
      '{"alpha":{"alpha":null,"beta":true},"zeta":[{"first":"one","second":"two"},"line\\nbreak"]}',
    );
  });

  test('produces identical bytes for equivalent objects with different insertion order', () => {
    const first = { outer: { z: 'last', a: 'first' }, value: 1 };
    const second = { value: 1, outer: { a: 'first', z: 'last' } };

    expect(serializeCanonicalJson(first)).toBe(serializeCanonicalJson(second));
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite number %p',
    (value) => {
      expect(() => serializeCanonicalJson(value)).toThrow(TypeError);
    },
  );

  test('rejects cyclic values, sparse arrays, symbol keys, and non-plain objects', () => {
    const cyclic: { self?: CanonicalJsonValue } = {};
    cyclic.self = cyclic;
    const sparse = Array.from({ length: 1 }) as CanonicalJsonValue[];
    delete sparse[0];
    const withSymbol = { value: 'visible' } as Record<
      string | symbol,
      CanonicalJsonValue
    >;
    withSymbol[Symbol('hidden')] = 'hidden';

    expect(() => serializeCanonicalJson(cyclic)).toThrow(TypeError);
    expect(() => serializeCanonicalJson(sparse)).toThrow(TypeError);
    expect(() =>
      serializeCanonicalJson(withSymbol as Record<string, CanonicalJsonValue>),
    ).toThrow(TypeError);
    expect(() =>
      serializeCanonicalJson(new Date() as unknown as CanonicalJsonValue),
    ).toThrow(TypeError);
  });
});
