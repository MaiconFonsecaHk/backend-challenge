import { describe, expect, test } from 'bun:test';
import {
  ConnectionException,
  DeadlockException,
  LockWaitTimeoutException,
} from '@mikro-orm/core';
import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';

import {
  IdempotencyConflictError,
  InvalidWagerCommandError,
  WagerTransactionNotFoundError,
} from '../../../src/application/errors/wager-application.error.js';
import {
  InvalidLedgerCursorError,
  WalletAlreadyExistsError,
  WalletNotFoundError,
} from '../../../src/application/errors/wallet-application.error.js';
import { mapHttpError } from '../../../src/interfaces/http/http-error-mapper.js';

describe('HTTP error mapping', () => {
  test.each([
    [new InvalidWagerCommandError('invalid kind'), HttpStatus.BAD_REQUEST],
    [new InvalidLedgerCursorError(), HttpStatus.BAD_REQUEST],
    [new WalletNotFoundError('wallet-id'), HttpStatus.NOT_FOUND],
    [new WagerTransactionNotFoundError(), HttpStatus.NOT_FOUND],
    [
      new WalletAlreadyExistsError('player-id', 'BRL'),
      HttpStatus.CONFLICT,
    ],
    [new IdempotencyConflictError('key'), HttpStatus.CONFLICT],
  ])('maps %s to its public status and stable code', (error, status) => {
    const mapped = mapHttpError(error);

    expect(mapped.status).toBe(status);
    expect(mapped.body).toEqual({
      statusCode: status,
      code: error.code,
      message: error.message,
      retryable: false,
    });
  });

  test('preserves stable contract details from an HTTP exception', () => {
    const mapped = mapHttpError(
      new BadRequestException({
        code: 'INVALID_HTTP_CONTRACT',
        message: 'The contract is invalid.',
        retryable: false,
        issues: [{ path: 'money.amount', message: 'Expected a string.' }],
      }),
    );

    expect(mapped).toEqual({
      status: HttpStatus.BAD_REQUEST,
      body: {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_HTTP_CONTRACT',
        message: 'The contract is invalid.',
        retryable: false,
        issues: [{ path: 'money.amount', message: 'Expected a string.' }],
      },
    });
  });

  test('normalizes framework exceptions without exposing their raw response', () => {
    expect(mapHttpError(new NotFoundException('secret internal route detail'))).toEqual({
      status: HttpStatus.NOT_FOUND,
      body: {
        statusCode: HttpStatus.NOT_FOUND,
        code: 'RESOURCE_NOT_FOUND',
        message: 'The requested resource was not found.',
        retryable: false,
      },
    });
  });

  test.each([
    new ConnectionException(new Error('connection lost')),
    new DeadlockException(new Error('deadlock detected')),
    new LockWaitTimeoutException(new Error('lock timeout')),
    Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }),
  ])('marks known transient infrastructure errors as retryable', (error) => {
    expect(mapHttpError(error)).toEqual({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'INFRASTRUCTURE_UNAVAILABLE',
        message:
          'A required infrastructure dependency is temporarily unavailable.',
        retryable: true,
      },
    });
  });

  test('hides unexpected error details and marks the failure as permanent', () => {
    expect(mapHttpError(new Error('database password leaked here'))).toEqual({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected internal error occurred.',
        retryable: false,
      },
    });
  });
});
