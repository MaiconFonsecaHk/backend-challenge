import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';

import type { EnvironmentVariables } from '../../config/environment.schema.js';
import {
  OPERATIONAL_METRICS,
  NOOP_OPERATIONAL_METRICS,
  type OperationalMetrics,
} from '../../application/ports/operational-metrics.js';
import { SQS_CLIENT } from '../../infrastructure/messaging/sqs.constants.js';
import { HEALTH_DEPENDENCY_TIMEOUT_MS } from './health.constants.js';

@Injectable()
export class SqsHealthIndicator {
  constructor(
    @Inject(SQS_CLIENT) private readonly client: SQSClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly healthIndicator: HealthIndicatorService,
    @Inject(OPERATIONAL_METRICS)
    private readonly metrics: OperationalMetrics = NOOP_OPERATIONAL_METRICS,
  ) {}

  async check() {
    const queueName = this.config.get('WAGER_TRANSACTIONS_QUEUE_NAME', {
      infer: true,
    });

    try {
      const result = await this.healthIndicator
        .check('sqs')
        .attempt(async ({ signal }) => {
          try {
            const response = await this.client.send(
              new GetQueueUrlCommand({ QueueName: queueName }),
              { abortSignal: signal },
            );

            if (response.QueueUrl === undefined) {
              throw new Error('Queue URL was not returned');
            }

            return { queue: queueName };
          } catch {
            throw new Error('SQS is unavailable');
          }
        })
        .withTimeout(HEALTH_DEPENDENCY_TIMEOUT_MS);
      this.metrics.setReadiness('sqs', true);
      return result;
    } catch (error) {
      this.metrics.setReadiness('sqs', false);
      throw error;
    }
  }
}
