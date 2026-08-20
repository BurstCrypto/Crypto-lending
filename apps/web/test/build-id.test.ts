import { describe, expect, it } from 'vitest';

import { LOCAL_BUILD_ID, resolveBuildId } from '../lib/build-id';

describe('resolveBuildId', () => {
  it('uses the full source revision for immutable container builds', () => {
    const revision = '0123456789abcdef0123456789abcdef01234567';

    expect(resolveBuildId({ SOURCE_REVISION: revision })).toBe(revision);
  });

  it('uses a stable local fallback instead of a random Next.js build ID', () => {
    expect(resolveBuildId({})).toBe(LOCAL_BUILD_ID);
    expect(resolveBuildId({ SOURCE_REVISION: '   ' })).toBe(LOCAL_BUILD_ID);
  });

  it.each([
    '0123456789abcdef',
    '0123456789ABCDEF0123456789ABCDEF01234567',
    'g123456789abcdef0123456789abcdef01234567',
    '0123456789abcdef0123456789abcdef012345678',
  ])('rejects an invalid source revision: %s', (revision) => {
    expect(() => resolveBuildId({ SOURCE_REVISION: revision })).toThrow(
      'SOURCE_REVISION must be a full lowercase 40-character Git commit SHA',
    );
  });
});
