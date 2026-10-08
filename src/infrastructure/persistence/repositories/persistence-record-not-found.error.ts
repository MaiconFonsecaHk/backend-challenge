export class PersistenceRecordNotFoundError extends Error {
  constructor(recordType: string, identity: string) {
    super(`${recordType} ${identity} was not found while saving`);
    this.name = 'PersistenceRecordNotFoundError';
  }
}
