import { HttpException, HttpStatus, PreconditionFailedException } from '@nestjs/common';

import { assertValidProfileVersion, type AccountId } from '../domain/account-profile';

const PROFILE_ETAG_PATTERN =
  /^"account-profile:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([1-9][0-9]{0,9})"$/u;

function preconditionFailed(): PreconditionFailedException {
  return new PreconditionFailedException({
    error: 'Precondition Failed',
    message: 'Profile version precondition failed',
    statusCode: HttpStatus.PRECONDITION_FAILED,
  });
}

export function formatProfileEtag(accountId: AccountId, version: number): string {
  return `"account-profile:${accountId}:${assertValidProfileVersion(version)}"`;
}

export function parseRequiredProfileIfMatch(value: unknown, accountId: AccountId): number {
  if (value === undefined) {
    throw new HttpException(
      {
        error: 'Precondition Required',
        message: 'If-Match header is required',
        statusCode: HttpStatus.PRECONDITION_REQUIRED,
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  if (typeof value !== 'string') {
    throw preconditionFailed();
  }

  const match = PROFILE_ETAG_PATTERN.exec(value);
  if (!match || match[1] !== accountId) {
    throw preconditionFailed();
  }

  const version = Number(match[2]);
  try {
    return assertValidProfileVersion(version);
  } catch {
    throw preconditionFailed();
  }
}
