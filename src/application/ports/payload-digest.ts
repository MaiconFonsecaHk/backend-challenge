export interface PayloadDigest {
  digest(canonicalJson: string): string;
}
