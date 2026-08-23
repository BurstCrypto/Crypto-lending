import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

interface HeaderWriter {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class WalletRegistrationPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<HeaderWriter>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie, Origin');
    return next.handle();
  }
}
