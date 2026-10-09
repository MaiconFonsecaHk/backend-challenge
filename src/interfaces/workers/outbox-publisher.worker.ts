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
import { PublishOutboxBatchUseCase } from '../../application/use-cases/messaging/publish-outbox-batch.use-case.js';
import type { EnvironmentVariables } from '../../config/environment.schema.js';

@Injectable()
export class OutboxPublisherWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private running = false;
  private loop?: Promise<void>;
  private wakeDelay?: () => void;

  constructor(
    private readonly publishBatch: PublishOutboxBatchUseCase,
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
        const result = await this.publishBatch.execute(
          this.config.get('OUTBOX_BATCH_SIZE', { infer: true }),
        );
        if (result.claimed > 0) {
          const context = {
            operation: 'OUTBOX_PUBLICATION',
            claimed: result.claimed,
            published: result.published,
            failed: result.failed,
          } as const;
          if (result.failed > 0) {
            this.logger.warn('outbox.batch.completed_with_retries', context);
          } else {
            this.logger.info('outbox.batch.completed', context);
          }
        }
      } catch (error) {
        this.logger.error('outbox.batch.failed', {
          operation: 'OUTBOX_PUBLICATION',
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
        this.config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true }),
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
