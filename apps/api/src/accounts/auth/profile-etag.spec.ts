import { HttpException, HttpStatus } from '@nestjs/common';

import { parseAccountId } from '../domain/account-profile';
import { formatProfileEtag, parseRequiredProfileIfMatch } from './profile-etag';

const ACCOUNT_ID = parseAccountId('0f27af0b-48b2-4f1b-b3d4-cd531a0b4458');
const OTHER_ACCOUNT_ID = parseAccountId('b72ff0b4-1ca0-4c12-9206-b8afaa6ce9f3');

describe('profile ETag preconditions', () => {
  it('round-trips a strong account-bound profile version', () => {
    const etag = formatProfileEtag(ACCOUNT_ID, 42);

    expect(etag).toBe(`"account-profile:${ACCOUNT_ID}:42"`);
    expect(parseRequiredProfileIfMatch(etag, ACCOUNT_ID)).toBe(42);
  });

  it('requires If-Match instead of allowing an unconditional update', () => {
    expectStatus(() => parseRequiredProfileIfMatch(undefined, ACCOUNT_ID), 428);
  });

  it.each([
    null,
    '',
    '*',
    `W/"account-profile:${ACCOUNT_ID}:1"`,
    `"account-profile:${ACCOUNT_ID}:1", "account-profile:${ACCOUNT_ID}:2"`,
    `"account-profile:${OTHER_ACCOUNT_ID}:1"`,
    `"account-profile:${ACCOUNT_ID}:0"`,
    `"account-profile:${ACCOUNT_ID}:2147483648"`,
    [`"account-profile:${ACCOUNT_ID}:1"`],
  ])('rejects weak, wildcard, multiple, cross-account, or malformed preconditions', (value) => {
    expectStatus(() => parseRequiredProfileIfMatch(value, ACCOUNT_ID), 412);
  });

  it.each([0, -1, 1.5, 2_147_483_648])('will not format an invalid version', (version) => {
    expect(() => formatProfileEtag(ACCOUNT_ID, version)).toThrow();
  });
});

function expectStatus(work: () => unknown, status: number): void {
  let captured: unknown;
  try {
    work();
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(HttpException);
  expect((captured as HttpException).getStatus()).toBe(status);
  expect((captured as HttpException).getStatus()).toBe(
    status === 428 ? HttpStatus.PRECONDITION_REQUIRED : HttpStatus.PRECONDITION_FAILED,
  );
}
