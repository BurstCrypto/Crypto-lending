import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

/**
 * Profile data is never shared-cacheable. Setting these headers before the
 * handler also covers validation, precondition, and persistence errors.
 */
@Injectable()
export class AccountProfilePrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<HeaderResponse>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Authorization');
    return next.handle();
  }
}
