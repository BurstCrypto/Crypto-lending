import {
  HttpException,
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { ReadinessAbuseLimiter } from './readiness-abuse-limiter';

interface HeaderResponse {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class ReadinessAbuseInterceptor implements NestInterceptor {
  constructor(private readonly limiter: ReadinessAbuseLimiter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const admission = this.limiter.tryAcquire();
    if (!admission.admitted) {
      const response = context.switchToHttp().getResponse<HeaderResponse>();
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Retry-After', String(admission.retryAfterSeconds));
      throw new HttpException(
        {
          error: 'Too Many Requests',
          message: 'Readiness request limit exceeded',
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      return next.handle().pipe(finalize(() => admission.lease.release()));
    } catch (error) {
      admission.lease.release();
      throw error;
    }
  }
}
