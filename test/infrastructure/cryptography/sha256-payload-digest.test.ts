import { describe, expect, test } from 'bun:test';

import { Sha256PayloadDigest } from '../../../src/infrastructure/cryptography/sha256-payload-digest.js';

describe('Sha256PayloadDigest', () => {
  test('returns the standard lowercase SHA-256 hex vector over UTF-8 bytes', () => {
    expect(new Sha256PayloadDigest().digest('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
