import type { EntityManager } from '@mikro-orm/postgresql';

import type {
  WagerTransactionRecord,
  WagerTransactionRepository,
} from '../../../application/ports/persistence/repositories.js';
import type { WagerTransactionKind } from '../../../domain/wagering/wager-transaction.js';
import { WagerTransactionPersistenceEntity } from '../entities/wager-transaction.persistence-entity.js';
import { WagerTransactionPersistenceMapper } from '../mappers/wager-transaction.persistence-mapper.js';
import { PersistenceRecordNotFoundError } from './persistence-record-not-found.error.js';

export class MikroOrmWagerTransactionRepository
  implements WagerTransactionRepository
{
  constructor(private readonly entityManager: EntityManager) {}

  async findById(id: string): Promise<WagerTransactionRecord | undefined> {
    const entity = await this.entityManager.findOne(
      WagerTransactionPersistenceEntity,
      { id },
    );

    return entity === null
      ? undefined
      : WagerTransactionPersistenceMapper.toRecord(entity);
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransactionRecord | undefined> {
    const entity = await this.entityManager.findOne(
      WagerTransactionPersistenceEntity,
      { idempotencyKey },
    );

    return entity === null
      ? undefined
      : WagerTransactionPersistenceMapper.toRecord(entity);
  }

  async findByProviderTransaction(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransactionRecord | undefined> {
    const entity = await this.entityManager.findOne(
      WagerTransactionPersistenceEntity,
      { providerId, externalTransactionId },
    );

    return entity === null
      ? undefined
      : WagerTransactionPersistenceMapper.toRecord(entity);
  }

  async findByReferenceAndKind(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<WagerTransactionRecord | undefined> {
    const entity = await this.entityManager.findOne(
      WagerTransactionPersistenceEntity,
      { referenceTransactionId, kind },
    );

    return entity === null
      ? undefined
      : WagerTransactionPersistenceMapper.toRecord(entity);
  }

  async add(record: WagerTransactionRecord): Promise<void> {
    const entity = this.entityManager.create(
      WagerTransactionPersistenceEntity,
      WagerTransactionPersistenceMapper.toPersistence(record),
    );

    this.entityManager.persist(entity);
  }

  async save(record: WagerTransactionRecord): Promise<void> {
    const { transaction } = record;
    const entity = await this.entityManager.findOne(
      WagerTransactionPersistenceEntity,
      { id: transaction.id },
    );

    if (entity === null) {
      throw new PersistenceRecordNotFoundError(
        'wager transaction',
        transaction.id,
      );
    }

    const state = WagerTransactionPersistenceMapper.toPersistence(record);
    this.entityManager.assign(entity, {
      status: state.status,
      referenceTransactionId: state.referenceTransactionId,
      failureCode: state.failureCode,
      processedAt: state.processedAt,
      resultBalanceAmount: state.resultBalanceAmount,
      resultBalanceCurrency: state.resultBalanceCurrency,
      referenceAttempts: state.referenceAttempts,
      nextReferenceAttemptAt: state.nextReferenceAttemptAt,
    });
  }
}
