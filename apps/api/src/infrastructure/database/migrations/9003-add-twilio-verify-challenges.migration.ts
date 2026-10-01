import type { DatabaseMigration } from './migration';

export const addTwilioVerifyChallengesMigration = {
  id: '9003',
  description: 'bind Railway SMS challenges to Twilio Verify',
  upSql: `
    -- Pending SMS logins must restart when moving between code providers.
    -- Account identities and sessions are unaffected.
    DELETE FROM passwordless_challenges WHERE channel = 'sms';
    ALTER TABLE passwordless_challenges
      ADD COLUMN sms_verification_sid text,
      ALTER COLUMN code_key_version DROP NOT NULL,
      ALTER COLUMN code_digest DROP NOT NULL,
      ADD CONSTRAINT passwordless_challenges_verification_source CHECK (
        (channel = 'email' AND code_key_version IS NOT NULL AND code_digest IS NOT NULL
          AND sms_verification_sid IS NULL)
        OR (channel = 'sms' AND code_key_version IS NULL AND code_digest IS NULL
          AND (sms_verification_sid IS NULL OR sms_verification_sid ~ '^VE[0-9a-fA-F]{32}$')
          AND (NOT sent OR sms_verification_sid IS NOT NULL))
      );
  `,
  downSql: `
    DELETE FROM passwordless_challenges WHERE channel = 'sms';
    ALTER TABLE passwordless_challenges
      DROP CONSTRAINT passwordless_challenges_verification_source,
      DROP COLUMN sms_verification_sid,
      ALTER COLUMN code_key_version SET NOT NULL,
      ALTER COLUMN code_digest SET NOT NULL;
  `,
  verifySql: `
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'passwordless_challenges'
        AND column_name = 'sms_verification_sid' AND data_type = 'text'
    ) AND (
      SELECT count(*) = 2 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'passwordless_challenges'
        AND column_name IN ('code_key_version', 'code_digest') AND is_nullable = 'YES'
    ) AND EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid = 'public.passwordless_challenges'::regclass
        AND conname = 'passwordless_challenges_verification_source' AND convalidated
    ) AND has_table_privilege('crypto_api_runtime', 'public.passwordless_challenges', 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('crypto_worker_runtime', 'public.passwordless_challenges', 'SELECT') AS valid;
  `,
} satisfies DatabaseMigration;
