export interface WalletPersistenceConflictClassifier {
  isWalletIdentityConflict(error: unknown): boolean;
}
