import { SQSClient } from '@aws-sdk/client-sqs';
import {
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { SQS_CLIENT } from './sqs.constants.js';

@Module({
  exports: [SQS_CLIENT],
  imports: [ConfigModule],
  providers: [
    {
      provide: SQS_CLIENT,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): SQSClient => {
        const accessKeyId = config.get('AWS_ACCESS_KEY_ID', { infer: true });
        const secretAccessKey = config.get('AWS_SECRET_ACCESS_KEY', {
          infer: true,
        });
        const credentials =
          accessKeyId !== undefined && secretAccessKey !== undefined
            ? { accessKeyId, secretAccessKey }
            : undefined;

        return new SQSClient({
          credentials,
          endpoint: config.get('SQS_ENDPOINT', { infer: true }),
          region: config.get('AWS_REGION', { infer: true }),
        });
      },
    },
  ],
})
export class SqsModule implements OnApplicationShutdown {
  constructor(@Inject(SQS_CLIENT) private readonly client: SQSClient) {}

  onApplicationShutdown(): void {
    this.client.destroy();
  }
}
