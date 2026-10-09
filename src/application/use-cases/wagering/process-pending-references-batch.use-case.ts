import type { Clock } from '../../ports/clock.js';
import {
  NOOP_OPERATIONAL_LOGGER,
  type OperationalLogger,
} from '../../ports/operational-logger.js';
import type { UnitOfWork } from '../../ports/persistence/unit-of-work.js';
import { WagerTransactionExecutor } from '../../services/wager-transaction.executor.js';
import { WagerTransactionStatus } from '../../../domain/wagering/wager-transaction.js';

export interface ProcessPendingReferencesBatchResult {
  readonly claimed: number;
  readonly processed: number;
  readonly rejected: number;
  readonly rescheduled: number;
}

export class ProcessPendingReferencesBatchUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly executor: WagerTransactionExecutor,
    private readonly clock: Clock,
    private readonly logger: OperationalLogger = NOOP_OPERATIONAL_LOGGER,
  ) {}

  async execute(limit: number): Promise<ProcessPendingReferencesBatchResult> {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error(
        'Pending-reference batch limit must be a positive safe integer.',
      );
    }

    let claimed = 0;
    let processed = 0;
    let rejected = 0;
    let rescheduled = 0;

    for (let index = 0; index < limit; index += 1) {
      const outcome = await this.unitOfWork.execute(async (repositories) => {
        const record =
          await repositories.wagerTransactions.findNextPendingReferenceDueForUpdate(
            this.clock.now(),
          );
        if (record === undefined) {
          return undefined;
        }

        const wallet = await repositories.wallets.findByIdForUpdate(
          record.transaction.walletId,
        );
        if (wallet === undefined) {
          throw new Error(
            `Pending wager transaction ${record.transaction.id} has no wallet.`,
          );
        }

        const updated = await this.executor.resumePendingReference(
          record,
          wallet,
          repositories,
        );
        await repositories.wagerTransactions.save(updated);
        return updated;
      });

      if (outcome === undefined) {
        break;
      }

      claimed += 1;
      const { transaction } = outcome;
      const context = {
        correlationId: transaction.id,
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        operation: transaction.kind,
        status: transaction.status,
        ...(transaction.failureCode === undefined
          ? {}
          : { failureCode: transaction.failureCode }),
        attempt: outcome.referenceAttempts,
      };
      if (transaction.status === WagerTransactionStatus.Processed) {
        processed += 1;
        this.logger.info('pending_reference.processed', context);
      } else if (transaction.status === WagerTransactionStatus.Rejected) {
        rejected += 1;
        this.logger.warn('pending_reference.rejected', context);
      } else if (
        transaction.status === WagerTransactionStatus.PendingReference
      ) {
        rescheduled += 1;
        this.logger.warn('pending_reference.retry_scheduled', {
          ...context,
          retryable: true,
        });
      } else {
        throw new Error(
          `Unexpected pending-reference outcome: ${transaction.status}`,
        );
      }
    }

    return Object.freeze({ claimed, processed, rejected, rescheduled });
  }
}
