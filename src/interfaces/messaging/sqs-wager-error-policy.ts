import {
  ConnectionException,
  DeadlockException,
  LockWaitTimeoutException,
} from '@mikro-orm/core';

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

export function isTransientWagerMessageError(error: unknown): boolean {
  if (
    error instanceof ConnectionException ||
    error instanceof DeadlockException ||
    error instanceof LockWaitTimeoutException
  ) {
    return true;
  }

  return (
    error instanceof Error &&
    'code' in error &&
    TRANSIENT_NETWORK_CODES.has(String(error.code))
  );
}

export function retryVisibilitySeconds(
  receiveCount: number,
  baseSeconds: number,
  maximumSeconds: number,
): number {
  const exponent = Math.max(0, receiveCount - 1);
  return Math.min(baseSeconds * 2 ** exponent, maximumSeconds);
}
