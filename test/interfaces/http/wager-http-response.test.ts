import { describe, expect, mock, test } from 'bun:test';
import { HttpException, HttpStatus } from '@nestjs/common';

import type { ProcessWagerTransactionResult } from '../../../src/application/ports/wager-transaction-processor.js';
import { WagerTransactionStatus } from '../../../src/domain/wagering/wager-transaction.js';
import { respondWithWagerResult } from '../../../src/interfaces/http/wager-http-response.js';

describe('wager HTTP outcome mapping', () => {
  test.each([
    [WagerTransactionStatus.Processed, HttpStatus.OK],
    [WagerTransactionStatus.Rejected, HttpStatus.UNPROCESSABLE_ENTITY],
    [WagerTransactionStatus.Pending, HttpStatus.ACCEPTED],
    [WagerTransactionStatus.PendingReference, HttpStatus.ACCEPTED],
  ])('maps %s to HTTP %i without changing the result', (status, httpStatus) => {
    const setStatus = mock(() => undefined);
    const result = wagerResult(status);

    expect(respondWithWagerResult({ status: setStatus }, result)).toBe(result);
    expect(setStatus).toHaveBeenCalledWith(httpStatus);
  });

  test('maps a permanent processing failure to a stable non-retryable error', () => {
    try {
      respondWithWagerResult(
        { status: mock(() => undefined) },
        wagerResult(WagerTransactionStatus.Failed, 'PROCESSING_EXHAUSTED'),
      );
      throw new Error('Expected the failed result to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
      expect((error as HttpException).getResponse()).toEqual({
        code: 'PROCESSING_EXHAUSTED',
        message: 'The wager transaction failed permanently.',
        retryable: false,
      });
    }
  });
});

function wagerResult(
  status: WagerTransactionStatus,
  failureCode?: string,
): ProcessWagerTransactionResult {
  return Object.freeze({
    transactionId: '30000000-0000-4000-8000-000000000603',
    status,
    ...(failureCode === undefined ? {} : { failureCode }),
    idempotentReplay: false,
  });
}
