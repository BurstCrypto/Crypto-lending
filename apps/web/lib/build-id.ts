const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40}$/;

export const LOCAL_BUILD_ID = 'local-unversioned';

type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Production container builds supply the full source revision. Local builds
 * use one stable fallback so Next.js does not generate a random build ID.
 */
export function resolveBuildId(environment: BuildEnvironment = process.env): string {
  const sourceRevision = environment.SOURCE_REVISION?.trim();
  if (!sourceRevision) return LOCAL_BUILD_ID;

  if (!SOURCE_REVISION_PATTERN.test(sourceRevision)) {
    throw new Error('SOURCE_REVISION must be a full lowercase 40-character Git commit SHA');
  }

  return sourceRevision;
}
