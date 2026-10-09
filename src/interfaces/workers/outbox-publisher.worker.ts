import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
        await this.publishBatch.execute(
          this.config.get('OUTBOX_BATCH_SIZE', { infer: true }),
        );
      } catch {
        // The transaction remains authoritative; the next poll retries due work.
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
