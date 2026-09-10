import type { DatabaseMigration } from './migration';

/**
 * Railway authenticates with its generated owner credential and enters one of
 * the stable NOLOGIN roles created by the bootstrap command. Recreate the
 * least-privilege runtime boundary without the AWS login-slot assumptions in
 * migration 0005.
 */
export const enforceRailwayDatabasePrincipalBoundariesMigration: DatabaseMigration = {
  id: '9000',
  description: 'enforce Railway database runtime principal boundaries',
  // Migration 0004's standalone verifier knows only the pre-boundary legacy
  // runtime ACL. This verifier replaces it after mapping those functions onto
  // the Railway API capability; the later 0007-0038 verifier chain remains live.
  supersedesVerificationOf: ['0004'],
  upSql: `
    REVOKE ALL PRIVILEGES ON SCHEMA public
      FROM PUBLIC, crypto_api_runtime, crypto_worker_runtime;
    GRANT USAGE ON SCHEMA public TO crypto_api_runtime, crypto_worker_runtime;

    REVOKE ALL PRIVILEGES ON TABLE schema_migrations, accounts, account_profiles,
      account_profile_audit, job_outbox
      FROM PUBLIC, crypto_api_runtime, crypto_worker_runtime;
    GRANT SELECT ON TABLE schema_migrations TO crypto_api_runtime, crypto_worker_runtime;
    GRANT SELECT ON TABLE accounts, account_profiles TO crypto_api_runtime;
    GRANT EXECUTE ON FUNCTION provision_account_profile(uuid, text, text, text, uuid, text)
      TO crypto_api_runtime;
    GRANT EXECUTE ON FUNCTION update_account_profile(
      uuid, integer, boolean, text, boolean, text, boolean, text, uuid, text
    ) TO crypto_api_runtime;
    REVOKE INSERT ON TABLE job_outbox FROM crypto_api_runtime;
    REVOKE INSERT (
      id, queue_name, payload, message_attributes, ledger_command_id, ledger_journal_id
    ) ON TABLE job_outbox FROM crypto_api_runtime;
    GRANT EXECUTE ON FUNCTION enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)
      TO crypto_api_runtime;
    GRANT SELECT, DELETE ON TABLE job_outbox TO crypto_worker_runtime;
    GRANT UPDATE (
      status, attempts, available_at, last_error, locked_by, locked_until,
      published_at, failed_at
    ) ON TABLE job_outbox TO crypto_worker_runtime;

    ALTER TABLE job_outbox ENABLE ROW LEVEL SECURITY;
    ALTER TABLE job_outbox FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS job_outbox_schema_owner_all ON job_outbox;
    DROP POLICY IF EXISTS job_outbox_api_insert ON job_outbox;
    DROP POLICY IF EXISTS job_outbox_worker_select ON job_outbox;
    DROP POLICY IF EXISTS job_outbox_worker_update ON job_outbox;
    DROP POLICY IF EXISTS job_outbox_worker_delete ON job_outbox;
    CREATE POLICY job_outbox_schema_owner_all ON job_outbox
      FOR ALL TO crypto_schema_owner USING (true) WITH CHECK (true);
    CREATE POLICY job_outbox_worker_select ON job_outbox
      FOR SELECT TO crypto_worker_runtime USING (true);
    CREATE POLICY job_outbox_worker_update ON job_outbox
      FOR UPDATE TO crypto_worker_runtime
      USING (status = 'pending')
      WITH CHECK (status IN ('pending', 'published', 'failed'));
    CREATE POLICY job_outbox_worker_delete ON job_outbox
      FOR DELETE TO crypto_worker_runtime USING (status IN ('published', 'failed'));

    ALTER DEFAULT PRIVILEGES FOR ROLE crypto_schema_owner IN SCHEMA public
      REVOKE ALL ON TABLES FROM PUBLIC, crypto_api_runtime, crypto_worker_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE crypto_schema_owner IN SCHEMA public
      REVOKE ALL ON SEQUENCES FROM PUBLIC, crypto_api_runtime, crypto_worker_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE crypto_schema_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE crypto_schema_owner REVOKE USAGE ON TYPES FROM PUBLIC;
  `,
  downSql: `DO $railway_boundary_irreversible$
    BEGIN
      RAISE EXCEPTION
        'Railway runtime principal boundaries are irreversible; restore from a reviewed backup instead'
        USING ERRCODE = '55000';
    END;
    $railway_boundary_irreversible$;`,
  verifySql: `
    SELECT
      pg_catalog.has_schema_privilege('crypto_api_runtime', 'public', 'USAGE')
      AND pg_catalog.has_schema_privilege('crypto_worker_runtime', 'public', 'USAGE')
      AND pg_catalog.has_table_privilege('crypto_api_runtime', 'accounts', 'SELECT')
      AND pg_catalog.has_table_privilege('crypto_api_runtime', 'account_profiles', 'SELECT')
      AND pg_catalog.has_function_privilege(
        'crypto_api_runtime',
        'provision_account_profile(uuid,text,text,text,uuid,text)',
        'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'crypto_api_runtime',
        'enqueue_reviewed_job_v1(text,text,jsonb,jsonb,text,text)',
        'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'crypto_api_runtime',
        'update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)',
        'EXECUTE'
      )
      AND pg_catalog.has_table_privilege('crypto_worker_runtime', 'job_outbox', 'SELECT,UPDATE,DELETE')
      AND NOT pg_catalog.has_table_privilege(
        'crypto_worker_runtime', 'job_outbox', 'INSERT,TRUNCATE,REFERENCES,TRIGGER'
      )
      AND NOT pg_catalog.has_table_privilege(
        'crypto_api_runtime', 'job_outbox', 'SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
      )
      AND (SELECT relrowsecurity AND relforcerowsecurity
           FROM pg_catalog.pg_class
           WHERE oid = pg_catalog.to_regclass('public.job_outbox'))
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy
        WHERE polrelid = pg_catalog.to_regclass('public.job_outbox')
          AND polname = 'job_outbox_schema_owner_all'
          AND polcmd = '*'
          AND polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'crypto_schema_owner')]::oid[]
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policy
        WHERE polrelid = pg_catalog.to_regclass('public.job_outbox')
          AND polname = 'job_outbox_api_insert'
      ) AS valid;
  `,
};
