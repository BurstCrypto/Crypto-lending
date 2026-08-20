import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

const PERMITTED_UPDATE_FIELDS = new Set([
  'contactEmail',
  'contactPhone',
  'declaredResidencyCountryCode',
]);

interface ProfileRequest {
  readonly body?: unknown;
  readonly method?: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidUpdateBody(): BadRequestException {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Profile update body is invalid',
    statusCode: 400,
  });
}

/** Rejects dangerous or unknown raw JSON keys after authentication, before DTO transformation. */
@Injectable()
export class AccountProfileBodyShapeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ProfileRequest>();
    if (request.method?.toUpperCase() !== 'PATCH') return next.handle();

    if (!isPlainRecord(request.body)) throw invalidUpdateBody();
    const fields = Object.keys(request.body);
    if (fields.length === 0 || fields.some((field) => !PERMITTED_UPDATE_FIELDS.has(field))) {
      throw invalidUpdateBody();
    }
    return next.handle();
  }
}
