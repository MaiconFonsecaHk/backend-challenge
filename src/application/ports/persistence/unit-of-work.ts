import type { PersistenceRepositories } from './repositories.js';

export const PERSISTENCE_UNIT_OF_WORK = Symbol('PERSISTENCE_UNIT_OF_WORK');

export type UnitOfWorkCallback<T> = (
  repositories: PersistenceRepositories,
) => Promise<T>;

export interface UnitOfWork {
  execute<T>(work: UnitOfWorkCallback<T>): Promise<T>;
}
