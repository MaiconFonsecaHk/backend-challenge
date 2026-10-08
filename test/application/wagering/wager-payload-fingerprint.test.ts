import { describe, expect, test } from 'bun:test';

import type { NormalizedWagerTransactionCommand } from '../../../src/application/ports/wager-transaction-processor.js';
import { WagerPayloadFingerprintService } from '../../../src/application/services/wager-payload-fingerprint.js';
import { WagerTransactionKind } from '../../../src/domain/wagering/wager-transaction.js';
import { Sha256PayloadDigest } from '../../../src/infrastructure/cryptography/sha256-payload-digest.js';

function command(
  overrides: Partial<NormalizedWagerTransactionCommand> = {},
): NormalizedWagerTransactionCommand {
  return {
    providerId: 'provider-a',
    externalTransactionId: 'external-501',
    idempotencyKey: 'provider-a:external-501',
    playerId: '20000000-0000-4000-8000-000000000501',
    walletId: '10000000-0000-4000-8000-000000000501',
    roundId: 'round-501',
    gameId: 'game-501',
    kind: WagerTransactionKind.Win,
    money: { amount: '25.00', currency: 'BRL' },
    referenceExternalTransactionId: 'referenced-bet',
    correlationId: 'correlation-501',
    ...overrides,
  };
}

describe('WagerPayloadFingerprintService', () => {
  const service = new WagerPayloadFingerprintService(new Sha256PayloadDigest());

  test('canonicalizes only the documented business fields in sorted order', () => {
    const canonicalJson = service.canonicalize(command());

    expect(canonicalJson).toBe(
      '{"externalTransactionId":"external-501","gameId":"game-501","kind":"WIN","money":{"amount":"25.00","currency":"BRL"},"playerId":"20000000-0000-4000-8000-000000000501","providerId":"provider-a","referenceExternalTransactionId":"referenced-bet","roundId":"round-501","walletId":"10000000-0000-4000-8000-000000000501"}',
    );
    expect(canonicalJson).not.toContain('idempotencyKey');
    expect(canonicalJson).not.toContain('correlationId');
  });

  test('keeps the fingerprint stable when only replay identity or transport metadata changes', () => {
    const expected = service.fingerprint(command());

    expect(
      service.fingerprint(
        command({
          idempotencyKey: 'another-replay-key',
          correlationId: 'another-correlation',
        }),
      ),
    ).toBe(expected);
  });

  test.each([
    { providerId: 'provider-b' },
    { externalTransactionId: 'external-502' },
    { playerId: '20000000-0000-4000-8000-000000000502' },
    { walletId: '10000000-0000-4000-8000-000000000502' },
    { roundId: 'round-502' },
    { gameId: 'game-502' },
    { kind: WagerTransactionKind.Refund },
    { money: { amount: '26.00', currency: 'BRL' } },
    { money: { amount: '25.00', currency: 'USD' } },
    { referenceExternalTransactionId: 'another-reference' },
  ])('changes the fingerprint when business payload changes: %o', (override) => {
    expect(service.fingerprint(command(override))).not.toBe(
      service.fingerprint(command()),
    );
  });

  test('distinguishes an absent optional reference from a supplied reference', () => {
    const withoutReference = command({
      kind: WagerTransactionKind.Bet,
      referenceExternalTransactionId: undefined,
    });

    expect(service.canonicalize(withoutReference)).not.toContain(
      'referenceExternalTransactionId',
    );
    expect(service.fingerprint(withoutReference)).not.toBe(
      service.fingerprint(command()),
    );
  });
});
