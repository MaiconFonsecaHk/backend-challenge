import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  OPERATIONAL_LOGGER,
  NOOP_OPERATIONAL_LOGGER,
  type OperationalLogger,
} from '../../application/ports/operational-logger.js';
import { ProcessPendingReferencesBatchUseCase } from '../../application/use-cases/wagering/process-pending-references-batch.use-case.js';
import type { EnvironmentVariables } from '../../config/environment.schema.js';

@Injectable()
export class PendingReferenceWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private running = false;
  private loop?: Promise<void>;
  private wakeDelay?: () => void;

  constructor(
    private readonly processBatch: ProcessPendingReferencesBatchUseCase,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    @Inject(OPERATIONAL_LOGGER)
    private readonly logger: OperationalLogger = NOOP_OPERATIONAL_LOGGER,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.wakeDelay?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.processBatch.execute(
          this.config.get('PENDING_REFERENCE_BATCH_SIZE', { infer: true }),
        );
        if (result.claimed > 0) {
          const context = {
            operation: 'PENDING_REFERENCE_RECOVERY',
            claimed: result.claimed,
            processed: result.processed,
            rejected: result.rejected,
            rescheduled: result.rescheduled,
          } as const;
          if (result.rejected > 0 || result.rescheduled > 0) {
            this.logger.warn(
              'pending_reference.batch.completed_with_pending_work',
              context,
            );
          } else {
            this.logger.info('pending_reference.batch.completed', context);
          }
        }
      } catch (error) {
        this.logger.error('pending_reference.batch.failed', {
          operation: 'PENDING_REFERENCE_RECOVERY',
          errorType: errorType(error),
          retryable: true,
        });
      }

      if (this.running) {
        await this.waitForNextPoll();
      }
    }
  }

  private waitForNextPoll(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(
        complete,
        this.config.get('PENDING_REFERENCE_POLL_INTERVAL_MS', { infer: true }),
      );
      const worker = this;

      function complete(): void {
        clearTimeout(timer);
        worker.wakeDelay = undefined;
        resolve();
      }

      this.wakeDelay = complete;
    });
  }
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'UnknownError';
}
