import { HttpException, HttpStatus } from '@nestjs/common';

import type { ProcessWagerTransactionResult } from '../../application/ports/wager-transaction-processor.js';
import { WagerTransactionStatus } from '../../domain/wagering/wager-transaction.js';

export interface HttpStatusResponse {
  status(statusCode: number): unknown;
}

export function respondWithWagerResult(
  response: HttpStatusResponse,
  result: ProcessWagerTransactionResult,
): ProcessWagerTransactionResult {
  switch (result.status) {
    case WagerTransactionStatus.Processed:
      response.status(HttpStatus.OK);
      return result;
    case WagerTransactionStatus.Rejected:
      response.status(HttpStatus.UNPROCESSABLE_ENTITY);
      return result;
    case WagerTransactionStatus.Pending:
    case WagerTransactionStatus.PendingReference:
      response.status(HttpStatus.ACCEPTED);
      return result;
    case WagerTransactionStatus.Failed:
      throw new HttpException(
        {
          code: result.failureCode ?? 'WAGER_PROCESSING_FAILED',
          message: 'The wager transaction failed permanently.',
          retryable: false,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
  }
}
