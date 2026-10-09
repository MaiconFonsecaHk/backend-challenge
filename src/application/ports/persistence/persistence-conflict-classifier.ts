export interface PersistenceConflictClassifier {
  isWagerIdempotencyKeyConflict(error: unknown): boolean;
  isWagerProviderTransactionConflict(error: unknown): boolean;
  isInboxIdentityConflict(error: unknown): boolean;
  isLockConflict(error: unknown): boolean;
}
