import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
        await this.processBatch.execute(
          this.config.get('PENDING_REFERENCE_BATCH_SIZE', { infer: true }),
        );
      } catch {
        // Rolled-back work remains due and can be claimed by the next poll.
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
