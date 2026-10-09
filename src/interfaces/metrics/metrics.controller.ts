import { Controller, Get, Inject, Res } from '@nestjs/common';

import {
  OPERATIONAL_METRICS,
  type OperationalMetrics,
} from '../../application/ports/operational-metrics.js';
import type { UnitOfWork } from '../../application/ports/persistence/unit-of-work.js';
import { PERSISTENCE_UNIT_OF_WORK } from '../../application/ports/persistence/unit-of-work.js';
import { SystemClock } from '../../infrastructure/time/system-clock.js';

interface MetricsHttpResponse {
  setHeader(name: string, value: string): void;
}

@Controller('metrics')
export class MetricsController {
  constructor(
    @Inject(OPERATIONAL_METRICS)
    private readonly metrics: OperationalMetrics,
    @Inject(PERSISTENCE_UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: SystemClock,
  ) {}

  @Get()
  async get(@Res({ passthrough: true }) response: MetricsHttpResponse) {
    await this.refreshOutboxState();
    response.setHeader('content-type', this.metrics.contentType());
    return this.metrics.render();
  }

  private async refreshOutboxState(): Promise<void> {
    try {
      const snapshot = await this.unitOfWork.execute((repositories) =>
        repositories.outboxMessages.getPendingSnapshot(),
      );
      const lagSeconds =
        snapshot.oldestPendingAt === undefined
          ? 0
          : Math.max(
              0,
              (this.clock.now().getTime() -
                snapshot.oldestPendingAt.getTime()) /
                1_000,
            );
      this.metrics.setOutboxState(snapshot.pendingMessages, lagSeconds);
    } catch {
      this.metrics.recordCollectionFailure('outbox');
    }
  }
}
