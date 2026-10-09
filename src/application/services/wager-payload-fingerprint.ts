import type { PayloadDigest } from '../ports/payload-digest.js';
import type { NormalizedWagerTransactionCommand } from '../ports/wager-transaction-processor.js';
import {
  serializeCanonicalJson,
  type CanonicalJsonValue,
} from '../serialization/canonical-json.js';

export class WagerPayloadFingerprintService {
  constructor(private readonly payloadDigest: PayloadDigest) {}

  canonicalize(command: NormalizedWagerTransactionCommand): string {
    const businessPayload: CanonicalJsonValue = {
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      playerId: command.playerId,
      walletId: command.walletId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      money: {
        amount: command.money.amount,
        currency: command.money.currency,
      },
      ...(command.referenceExternalTransactionId === undefined
        ? {}
        : {
            referenceExternalTransactionId:
              command.referenceExternalTransactionId,
          }),
    };

    return serializeCanonicalJson(businessPayload);
  }

  fingerprint(command: NormalizedWagerTransactionCommand): string {
    return this.payloadDigest.digest(this.canonicalize(command));
  }
}
