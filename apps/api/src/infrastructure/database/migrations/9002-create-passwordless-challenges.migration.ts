import type { DatabaseMigration } from './migration';

export const createPasswordlessChallengesMigration: DatabaseMigration = {
  id: '9002',
  description: 'create browser-bound passwordless challenges for Railway',
  upSql: `
    CREATE TABLE passwordless_challenges (
      id uuid PRIMARY KEY,
      channel text NOT NULL CHECK (channel IN ('email', 'sms')),
      destination text NOT NULL CHECK (length(destination) BETWEEN 3 AND 254),
      code_key_version smallint NOT NULL CHECK (code_key_version > 0),
      code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
      browser_digest bytea NOT NULL CHECK (octet_length(browser_digest) = 32),
      sent boolean NOT NULL DEFAULT false,
      failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '10 minutes',
      verified_at timestamptz,
      consumed_at timestamptz,
      CHECK (expires_at > created_at AND expires_at <= created_at + interval '11 minutes'),
      CHECK (consumed_at IS NULL OR verified_at IS NOT NULL)
    );
    CREATE INDEX passwordless_challenges_expiry_idx ON passwordless_challenges (expires_at);
    REVOKE ALL ON passwordless_challenges FROM PUBLIC, crypto_api_runtime, crypto_worker_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON passwordless_challenges TO crypto_api_runtime;

    -- Read only the identity mapping for the verified native namespace. Profile
    -- contact details are deliberately never used as authentication credentials.
    CREATE FUNCTION passwordless_identity_exists(
      requested_issuer text, requested_provider text,
      requested_versions smallint[], requested_digests text[]
    ) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path = pg_catalog, public AS $passwordless_identity$
      SELECT requested_provider IN ('passwordless_email', 'passwordless_sms') AND EXISTS (
        SELECT 1 FROM public.auth_oidc_identity_digest_aliases AS identity
        JOIN unnest(requested_versions, requested_digests) AS candidate(version, digest)
          ON identity.subject_digest_version = candidate.version
          AND identity.subject_digest = decode(candidate.digest, 'hex')
        WHERE identity.issuer = requested_issuer AND identity.provider_key = requested_provider
      );
    $passwordless_identity$;
    REVOKE ALL ON FUNCTION passwordless_identity_exists(text,text,smallint[],text[])
      FROM PUBLIC, crypto_api_runtime, crypto_worker_runtime;
    GRANT EXECUTE ON FUNCTION passwordless_identity_exists(text,text,smallint[],text[])
      TO crypto_api_runtime;
  `,
  downSql: `
    DROP FUNCTION passwordless_identity_exists(text,text,smallint[],text[]);
    DROP TABLE passwordless_challenges;
  `,
  verifySql: `
    SELECT to_regclass('public.passwordless_challenges') IS NOT NULL
      AND has_table_privilege('crypto_api_runtime', 'public.passwordless_challenges', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('crypto_worker_runtime', 'public.passwordless_challenges', 'SELECT')
      AND has_function_privilege('crypto_api_runtime', 'passwordless_identity_exists(text,text,smallint[],text[])', 'EXECUTE')
      AND NOT has_function_privilege('crypto_worker_runtime', 'passwordless_identity_exists(text,text,smallint[],text[])', 'EXECUTE') AS valid;
  `,
};
