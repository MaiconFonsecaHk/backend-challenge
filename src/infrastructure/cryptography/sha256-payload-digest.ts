import { createHash } from 'node:crypto';

import type { PayloadDigest } from '../../application/ports/payload-digest.js';

export class Sha256PayloadDigest implements PayloadDigest {
  digest(canonicalJson: string): string {
    return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  }
}
