import type { Clock } from '../../ports/clock.js';
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
        return updated.transaction.status;
      });

      if (outcome === undefined) {
        break;
      }

      claimed += 1;
      if (outcome === WagerTransactionStatus.Processed) {
        processed += 1;
      } else if (outcome === WagerTransactionStatus.Rejected) {
        rejected += 1;
      } else if (outcome === WagerTransactionStatus.PendingReference) {
        rescheduled += 1;
      } else {
        throw new Error(`Unexpected pending-reference outcome: ${outcome}`);
      }
    }

    return Object.freeze({ claimed, processed, rejected, rescheduled });
  }
}
