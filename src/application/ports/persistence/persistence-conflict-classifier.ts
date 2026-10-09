export interface PersistenceConflictClassifier {
  isWagerIdempotencyKeyConflict(error: unknown): boolean;
  isInboxIdentityConflict(error: unknown): boolean;
}
