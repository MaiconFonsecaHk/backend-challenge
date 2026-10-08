export interface PersistenceConflictClassifier {
  isWagerIdempotencyKeyConflict(error: unknown): boolean;
}
