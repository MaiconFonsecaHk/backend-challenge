import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';

@Injectable()
export class DeferredProviderAuthenticationGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
