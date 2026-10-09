import {
  ConnectionException,
  DeadlockException,
  LockWaitTimeoutException,
} from '@mikro-orm/core';
import { HttpException, HttpStatus } from '@nestjs/common';

import { ApplicationError } from '../../application/errors/application.error.js';

export interface HttpErrorResponse {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly issues?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
}

export interface MappedHttpError {
  readonly status: number;
  readonly body: HttpErrorResponse;
}

const APPLICATION_ERROR_STATUS = new Map<string, number>([
  ['INVALID_CORRELATION_ID', HttpStatus.BAD_REQUEST],
  ['INVALID_LEDGER_PAGE_LIMIT', HttpStatus.BAD_REQUEST],
  ['INVALID_LEDGER_CURSOR', HttpStatus.BAD_REQUEST],
  ['INVALID_WAGER_COMMAND', HttpStatus.BAD_REQUEST],
  ['EXTERNAL_OPENING_NOT_ALLOWED', HttpStatus.UNPROCESSABLE_ENTITY],
  ['WALLET_NOT_FOUND', HttpStatus.NOT_FOUND],
  ['WAGER_TRANSACTION_NOT_FOUND', HttpStatus.NOT_FOUND],
  ['WALLET_ALREADY_EXISTS', HttpStatus.CONFLICT],
  ['IDEMPOTENCY_CONFLICT', HttpStatus.CONFLICT],
]);

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

export function mapHttpError(error: unknown): MappedHttpError {
  if (error instanceof ApplicationError) {
    const status = APPLICATION_ERROR_STATUS.get(error.code);
    if (status !== undefined) {
      return mapped(status, error.code, error.message, false);
    }
  }

  if (error instanceof HttpException) {
    return mapHttpException(error);
  }

  if (isTransientInfrastructureError(error)) {
    return mapped(
      HttpStatus.SERVICE_UNAVAILABLE,
      'INFRASTRUCTURE_UNAVAILABLE',
      'A required infrastructure dependency is temporarily unavailable.',
      true,
    );
  }

  return mapped(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'INTERNAL_ERROR',
    'An unexpected internal error occurred.',
    false,
  );
}

function mapHttpException(error: HttpException): MappedHttpError {
  const status = error.getStatus();
  const response = error.getResponse();
  if (isStableHttpError(response)) {
    return Object.freeze({
      status,
      body: Object.freeze({
        statusCode: status,
        code: response.code,
        message: response.message,
        retryable: response.retryable ?? false,
        ...(response.issues === undefined
          ? {}
          : { issues: Object.freeze(response.issues) }),
      }),
    });
  }

  return mapped(
    status,
    defaultHttpCode(status),
    defaultHttpMessage(status),
    status === HttpStatus.SERVICE_UNAVAILABLE,
  );
}

function mapped(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
): MappedHttpError {
  return Object.freeze({
    status,
    body: Object.freeze({ statusCode: status, code, message, retryable }),
  });
}

function isTransientInfrastructureError(error: unknown): boolean {
  if (
    error instanceof ConnectionException ||
    error instanceof DeadlockException ||
    error instanceof LockWaitTimeoutException
  ) {
    return true;
  }

  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }

  return TRANSIENT_ERROR_CODES.has(String(error.code));
}

interface StableHttpErrorSource {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly issues?: readonly {
    readonly path: string;
    readonly message: string;
  }[];
}

function isStableHttpError(value: unknown): value is StableHttpErrorSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    (!('retryable' in value) || typeof value.retryable === 'boolean') &&
    (!('issues' in value) || Array.isArray(value.issues))
  );
}

function defaultHttpCode(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.NOT_FOUND:
      return 'RESOURCE_NOT_FOUND';
    case HttpStatus.METHOD_NOT_ALLOWED:
      return 'METHOD_NOT_ALLOWED';
    default:
      return 'HTTP_ERROR';
  }
}

function defaultHttpMessage(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'The request is invalid.';
    case HttpStatus.NOT_FOUND:
      return 'The requested resource was not found.';
    case HttpStatus.METHOD_NOT_ALLOWED:
      return 'The HTTP method is not allowed for this resource.';
    default:
      return 'The request could not be completed.';
  }
}
