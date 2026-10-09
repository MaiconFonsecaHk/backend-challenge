import { describe, expect, test } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { HealthController } from '../../../src/interfaces/health/health.controller.js';
import { DeferredProviderAuthenticationGuard } from '../../../src/interfaces/http/deferred-provider-auth.guard.js';
import { WalletController } from '../../../src/interfaces/http/wallet.controller.js';
import {
  ProviderWageringController,
  WageringController,
} from '../../../src/interfaces/http/wagering.controller.js';

describe('provider authentication extension point', () => {
  test('allows requests while external identity integration is deferred', () => {
    const guard = new DeferredProviderAuthenticationGuard();

    expect(guard.canActivate({} as ExecutionContext)).toBeTrue();
  });

  test.each([
    WalletController,
    WageringController,
    ProviderWageringController,
  ])('protects each financial controller with the replaceable guard', (controller) => {
    const guards: unknown[] | undefined = Reflect.getMetadata(
      GUARDS_METADATA,
      controller,
    );

    expect(guards).toContain(DeferredProviderAuthenticationGuard);
  });

  test('keeps health checks outside the provider authentication boundary', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, HealthController)).toBeUndefined();
  });
});
