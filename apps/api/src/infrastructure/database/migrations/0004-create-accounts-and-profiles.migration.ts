import type { DatabaseMigration } from './migration';

const ISO_3166_ALPHA_2_CODES = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
] as const;

const ISO_3166_ALPHA_2_SQL = ISO_3166_ALPHA_2_CODES.map((code) => `'${code}'`).join(', ');

export const createAccountsAndProfilesMigration: DatabaseMigration = {
  id: '0004',
  description: 'create immutable accounts and auditable profiles',
  upSql: `
    CREATE TABLE accounts (
      account_id uuid PRIMARY KEY,
      eligibility_status text NOT NULL DEFAULT 'UNKNOWN',
      created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT accounts_account_id_uuid_v4_check CHECK (
        substring(account_id::text FROM 15 FOR 1) = '4'
        AND substring(account_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT accounts_eligibility_unknown_check CHECK (
        eligibility_status = 'UNKNOWN'
      )
    );

    CREATE TABLE account_profiles (
      account_id uuid PRIMARY KEY,
      contact_email text NOT NULL,
      contact_phone text,
      declared_residency_country_code text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT account_profiles_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT account_profiles_contact_email_check CHECK (
        char_length(contact_email) BETWEEN 3 AND 254
        AND octet_length(contact_email) = char_length(contact_email)
        AND contact_email ~ '^[!-~]+$'
        AND char_length(contact_email) - char_length(replace(contact_email, '@', '')) = 1
        AND char_length(split_part(contact_email, '@', 1)) BETWEEN 1 AND 64
        AND translate(
          split_part(contact_email, '@', 1),
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&''*+/=?^_\`{|}~.-',
          ''
        ) = ''
        AND left(split_part(contact_email, '@', 1), 1) <> '.'
        AND right(split_part(contact_email, '@', 1), 1) <> '.'
        AND split_part(contact_email, '@', 1) NOT LIKE '%..%'
        AND char_length(split_part(contact_email, '@', 2)) BETWEEN 1 AND 253
        AND split_part(contact_email, '@', 2) = lower(split_part(contact_email, '@', 2))
        AND split_part(contact_email, '@', 2)
          ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
      ),
      CONSTRAINT account_profiles_contact_phone_check CHECK (
        contact_phone IS NULL OR contact_phone ~ '^\\+[1-9][0-9]{1,14}$'
      ),
      CONSTRAINT account_profiles_country_check CHECK (
        declared_residency_country_code IN (${ISO_3166_ALPHA_2_SQL})
      ),
      CONSTRAINT account_profiles_version_check CHECK (version > 0),
      CONSTRAINT account_profiles_timestamps_check CHECK (updated_at >= created_at)
    );

    CREATE TABLE account_profile_audit (
      audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id uuid NOT NULL,
      actor_account_id uuid NOT NULL,
      correlation_id text NOT NULL,
      action text NOT NULL,
      result text NOT NULL DEFAULT 'SUCCEEDED',
      before_version integer,
      after_version integer NOT NULL,
      changed_fields text[] NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
      CONSTRAINT account_profile_audit_id_uuid_v4_check CHECK (
        substring(audit_id::text FROM 15 FOR 1) = '4'
        AND substring(audit_id::text FROM 20 FOR 1) IN ('8', '9', 'a', 'b')
      ),
      CONSTRAINT account_profile_audit_account_fk FOREIGN KEY (account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT account_profile_audit_actor_fk FOREIGN KEY (actor_account_id)
        REFERENCES accounts (account_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
      CONSTRAINT account_profile_audit_correlation_check CHECK (
        char_length(correlation_id) BETWEEN 1 AND 128
        AND correlation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      ),
      CONSTRAINT account_profile_audit_action_check CHECK (
        action IN ('PROVISIONED', 'UPDATED')
      ),
      CONSTRAINT account_profile_audit_result_check CHECK (result = 'SUCCEEDED'),
      CONSTRAINT account_profile_audit_version_transition_check CHECK (
        (action = 'PROVISIONED' AND before_version IS NULL AND after_version = 1)
        OR (
          action = 'UPDATED'
          AND before_version IS NOT NULL
          AND before_version > 0
          AND after_version = before_version + 1
        )
      ),
      CONSTRAINT account_profile_audit_changed_fields_check CHECK (
        cardinality(changed_fields) BETWEEN 1 AND 3
        AND changed_fields <@ ARRAY[
          'contactEmail'::text,
          'contactPhone'::text,
          'declaredResidencyCountryCode'::text
        ]
      )
    );

    CREATE INDEX account_profile_audit_account_timeline_idx
      ON account_profile_audit (account_id, occurred_at, audit_id);
    CREATE INDEX account_profile_audit_correlation_idx
      ON account_profile_audit (correlation_id, occurred_at, audit_id);

    CREATE FUNCTION enforce_account_immutability()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
    BEGIN
      IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
        RAISE EXCEPTION 'account identity is immutable' USING ERRCODE = '23514';
      END IF;
      IF NEW.eligibility_status IS DISTINCT FROM OLD.eligibility_status THEN
        RAISE EXCEPTION 'account eligibility is not managed by the profile domain'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'account creation timestamp is immutable' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER accounts_immutable_fields_trigger
      BEFORE UPDATE ON accounts
      FOR EACH ROW EXECUTE FUNCTION enforce_account_immutability();

    CREATE FUNCTION enforce_account_profile_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
    BEGIN
      IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
        RAISE EXCEPTION 'profile account identity is immutable' USING ERRCODE = '23514';
      END IF;
      IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'profile creation timestamp is immutable' USING ERRCODE = '23514';
      END IF;
      IF NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'profile version is managed by the database' USING ERRCODE = '23514';
      END IF;
      IF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
        RAISE EXCEPTION 'profile update timestamp is managed by the database'
          USING ERRCODE = '23514';
      END IF;

      NEW.version := OLD.version + 1;
      NEW.updated_at := greatest(
        statement_timestamp(),
        OLD.updated_at + INTERVAL '1 microsecond'
      );
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER account_profiles_managed_update_trigger
      BEFORE UPDATE ON account_profiles
      FOR EACH ROW EXECUTE FUNCTION enforce_account_profile_update();

    CREATE FUNCTION reject_account_profile_audit_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog
    AS $$
    BEGIN
      RAISE EXCEPTION 'account profile audit records are append-only' USING ERRCODE = '55000';
    END;
    $$;

    CREATE TRIGGER account_profile_audit_append_only_row_trigger
      BEFORE UPDATE OR DELETE ON account_profile_audit
      FOR EACH ROW EXECUTE FUNCTION reject_account_profile_audit_mutation();
    CREATE TRIGGER account_profile_audit_append_only_truncate_trigger
      BEFORE TRUNCATE ON account_profile_audit
      FOR EACH STATEMENT EXECUTE FUNCTION reject_account_profile_audit_mutation();

    CREATE FUNCTION provision_account_profile(
      requested_account_id uuid,
      requested_contact_email text,
      requested_contact_phone text,
      requested_residency_country_code text,
      requested_actor_account_id uuid,
      requested_correlation_id text
    )
    RETURNS TABLE (
      profile_account_id uuid,
      profile_contact_email text,
      profile_contact_phone text,
      profile_residency_country_code text,
      account_eligibility_status text,
      profile_version integer,
      profile_created_at timestamptz,
      profile_updated_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      created_profile account_profiles%ROWTYPE;
      created_eligibility text;
      profile_insert_count bigint;
      audit_insert_count bigint;
    BEGIN
      IF requested_actor_account_id IS DISTINCT FROM requested_account_id THEN
        RAISE EXCEPTION 'account profile actor does not match target' USING ERRCODE = '42501';
      END IF;

      INSERT INTO accounts (account_id)
      VALUES (requested_account_id);

      INSERT INTO account_profiles (
        account_id,
        contact_email,
        contact_phone,
        declared_residency_country_code
      )
      VALUES (
        requested_account_id,
        requested_contact_email,
        requested_contact_phone,
        requested_residency_country_code
      )
      RETURNING account_id,
                contact_email,
                contact_phone,
                declared_residency_country_code,
                version,
                created_at,
                updated_at
      INTO created_profile;
      GET DIAGNOSTICS profile_insert_count = ROW_COUNT;

      IF profile_insert_count <> 1 THEN
        RAISE EXCEPTION 'account profile provisioning did not create one profile'
          USING ERRCODE = '55000';
      END IF;

      INSERT INTO account_profile_audit (
        account_id,
        actor_account_id,
        correlation_id,
        action,
        result,
        before_version,
        after_version,
        changed_fields
      )
      VALUES (
        created_profile.account_id,
        requested_actor_account_id,
        requested_correlation_id,
        'PROVISIONED',
        'SUCCEEDED',
        NULL,
        created_profile.version,
        ARRAY[
          'contactEmail'::text,
          'contactPhone'::text,
          'declaredResidencyCountryCode'::text
        ]
      );
      GET DIAGNOSTICS audit_insert_count = ROW_COUNT;

      IF audit_insert_count IS DISTINCT FROM profile_insert_count THEN
        RAISE EXCEPTION 'account profile provisioning audit transition is incomplete'
          USING ERRCODE = '55000';
      END IF;

      SELECT account.eligibility_status
      INTO created_eligibility
      FROM accounts AS account
      WHERE account.account_id = created_profile.account_id;

      RETURN QUERY SELECT created_profile.account_id,
                          created_profile.contact_email,
                          created_profile.contact_phone,
                          created_profile.declared_residency_country_code,
                          created_eligibility,
                          created_profile.version,
                          created_profile.created_at,
                          created_profile.updated_at;
    END;
    $$;

    CREATE FUNCTION update_account_profile(
      requested_account_id uuid,
      requested_expected_version integer,
      requested_has_contact_email boolean,
      requested_contact_email text,
      requested_has_contact_phone boolean,
      requested_contact_phone text,
      requested_has_residency_country_code boolean,
      requested_residency_country_code text,
      requested_actor_account_id uuid,
      requested_correlation_id text
    )
    RETURNS TABLE (
      update_outcome text,
      profile_account_id uuid,
      profile_contact_email text,
      profile_contact_phone text,
      profile_residency_country_code text,
      account_eligibility_status text,
      profile_version integer,
      profile_created_at timestamptz,
      profile_updated_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      updated_profile account_profiles%ROWTYPE;
      updated_eligibility text;
      changed_fields text[];
      target_exists boolean;
      profile_update_count bigint;
      audit_insert_count bigint;
    BEGIN
      IF requested_actor_account_id IS DISTINCT FROM requested_account_id THEN
        RAISE EXCEPTION 'account profile actor does not match target' USING ERRCODE = '42501';
      END IF;
      IF requested_expected_version IS NULL OR requested_expected_version < 1 THEN
        RAISE EXCEPTION 'account profile version is invalid' USING ERRCODE = '22023';
      END IF;
      IF requested_has_contact_email IS NULL
        OR requested_has_contact_phone IS NULL
        OR requested_has_residency_country_code IS NULL
        OR NOT (
          requested_has_contact_email
          OR requested_has_contact_phone
          OR requested_has_residency_country_code
        )
      THEN
        RAISE EXCEPTION 'account profile update fields are invalid' USING ERRCODE = '22023';
      END IF;

      changed_fields := pg_catalog.array_remove(
        ARRAY[
          CASE WHEN requested_has_contact_email THEN 'contactEmail'::text END,
          CASE WHEN requested_has_contact_phone THEN 'contactPhone'::text END,
          CASE
            WHEN requested_has_residency_country_code
              THEN 'declaredResidencyCountryCode'::text
          END
        ],
        NULL::text
      );

      UPDATE account_profiles AS profile
      SET contact_email = CASE
            WHEN requested_has_contact_email THEN requested_contact_email
            ELSE profile.contact_email
          END,
          contact_phone = CASE
            WHEN requested_has_contact_phone THEN requested_contact_phone
            ELSE profile.contact_phone
          END,
          declared_residency_country_code = CASE
            WHEN requested_has_residency_country_code THEN requested_residency_country_code
            ELSE profile.declared_residency_country_code
          END
      WHERE profile.account_id = requested_account_id
        AND profile.version = requested_expected_version
      RETURNING profile.account_id,
                profile.contact_email,
                profile.contact_phone,
                profile.declared_residency_country_code,
                profile.version,
                profile.created_at,
                profile.updated_at
      INTO updated_profile;
      GET DIAGNOSTICS profile_update_count = ROW_COUNT;

      IF profile_update_count = 0 THEN
        SELECT EXISTS (
          SELECT 1
          FROM account_profiles AS profile
          WHERE profile.account_id = requested_account_id
        ) INTO target_exists;

        RETURN QUERY SELECT CASE
                              WHEN target_exists THEN 'stale'::text
                              ELSE 'not-found'::text
                            END,
                            NULL::uuid,
                            NULL::text,
                            NULL::text,
                            NULL::text,
                            NULL::text,
                            NULL::integer,
                            NULL::timestamptz,
                            NULL::timestamptz;
        RETURN;
      END IF;
      IF profile_update_count <> 1 THEN
        RAISE EXCEPTION 'account profile update affected an invalid number of profiles'
          USING ERRCODE = '55000';
      END IF;

      INSERT INTO account_profile_audit (
        account_id,
        actor_account_id,
        correlation_id,
        action,
        result,
        before_version,
        after_version,
        changed_fields
      )
      VALUES (
        updated_profile.account_id,
        requested_actor_account_id,
        requested_correlation_id,
        'UPDATED',
        'SUCCEEDED',
        updated_profile.version - 1,
        updated_profile.version,
        changed_fields
      );
      GET DIAGNOSTICS audit_insert_count = ROW_COUNT;

      IF audit_insert_count IS DISTINCT FROM profile_update_count THEN
        RAISE EXCEPTION 'account profile update audit transition is incomplete'
          USING ERRCODE = '55000';
      END IF;

      SELECT account.eligibility_status
      INTO updated_eligibility
      FROM accounts AS account
      WHERE account.account_id = updated_profile.account_id;

      RETURN QUERY SELECT 'updated'::text,
                          updated_profile.account_id,
                          updated_profile.contact_email,
                          updated_profile.contact_phone,
                          updated_profile.declared_residency_country_code,
                          updated_eligibility,
                          updated_profile.version,
                          updated_profile.created_at,
                          updated_profile.updated_at;
    END;
    $$;

    DO $capture_account_profile_function_path$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
    BEGIN
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.provision_account_profile(uuid, text, text, text, uuid, text) '
        'SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
      EXECUTE pg_catalog.format(
        'ALTER FUNCTION %I.update_account_profile('
        'uuid, integer, boolean, text, boolean, text, boolean, text, uuid, text) '
        'SET search_path TO pg_catalog, %I, pg_temp',
        migration_schema,
        migration_schema
      );
    END;
    $capture_account_profile_function_path$;

    REVOKE ALL ON FUNCTION enforce_account_immutability() FROM PUBLIC;
    REVOKE ALL ON FUNCTION enforce_account_profile_update() FROM PUBLIC;
    REVOKE ALL ON FUNCTION reject_account_profile_audit_mutation() FROM PUBLIC;
    REVOKE ALL ON FUNCTION provision_account_profile(uuid, text, text, text, uuid, text)
      FROM PUBLIC;
    REVOKE ALL ON FUNCTION update_account_profile(
      uuid, integer, boolean, text, boolean, text, boolean, text, uuid, text
    ) FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE accounts FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE account_profiles FROM PUBLIC;
    REVOKE ALL PRIVILEGES ON TABLE account_profile_audit FROM PUBLIC;

    DO $grant_account_profile_runtime_boundary$
    DECLARE
      migration_schema text := pg_catalog.current_schema();
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'crypto_runtime') THEN
        REVOKE ALL PRIVILEGES ON TABLE accounts FROM crypto_runtime;
        REVOKE ALL PRIVILEGES ON TABLE account_profiles FROM crypto_runtime;
        REVOKE ALL PRIVILEGES ON TABLE account_profile_audit FROM crypto_runtime;
        REVOKE ALL ON FUNCTION enforce_account_immutability() FROM crypto_runtime;
        REVOKE ALL ON FUNCTION enforce_account_profile_update() FROM crypto_runtime;
        REVOKE ALL ON FUNCTION reject_account_profile_audit_mutation() FROM crypto_runtime;

        EXECUTE pg_catalog.format(
          'REVOKE ALL PRIVILEGES ON SCHEMA %I FROM crypto_runtime',
          migration_schema
        );
        EXECUTE pg_catalog.format(
          'GRANT USAGE ON SCHEMA %I TO crypto_runtime',
          migration_schema
        );
        GRANT SELECT ON TABLE accounts TO crypto_runtime;
        GRANT SELECT ON TABLE account_profiles TO crypto_runtime;
        GRANT EXECUTE ON FUNCTION provision_account_profile(
          uuid, text, text, text, uuid, text
        ) TO crypto_runtime;
        GRANT EXECUTE ON FUNCTION update_account_profile(
          uuid, integer, boolean, text, boolean, text, boolean, text, uuid, text
        ) TO crypto_runtime;
      END IF;
    END;
    $grant_account_profile_runtime_boundary$;
  `,
  downSql: `
    DROP FUNCTION IF EXISTS update_account_profile(
      uuid, integer, boolean, text, boolean, text, boolean, text, uuid, text
    );
    DROP FUNCTION IF EXISTS provision_account_profile(uuid, text, text, text, uuid, text);
    DROP TABLE IF EXISTS account_profile_audit;
    DROP TABLE IF EXISTS account_profiles;
    DROP TABLE IF EXISTS accounts;
    DROP FUNCTION IF EXISTS reject_account_profile_audit_mutation();
    DROP FUNCTION IF EXISTS enforce_account_profile_update();
    DROP FUNCTION IF EXISTS enforce_account_immutability();
  `,
  verifySql: `SELECT (
    to_regclass('accounts') IS NOT NULL
    AND to_regclass('account_profiles') IS NOT NULL
    AND to_regclass('account_profile_audit') IS NOT NULL
    AND to_regprocedure('enforce_account_immutability()') IS NOT NULL
    AND to_regprocedure('enforce_account_profile_update()') IS NOT NULL
    AND to_regprocedure('reject_account_profile_audit_mutation()') IS NOT NULL
    AND to_regprocedure(
      'provision_account_profile(uuid,text,text,text,uuid,text)'
    ) IS NOT NULL
    AND to_regprocedure(
      'update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'
    ) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('accounts', 'account_id', 'uuid', true, NULL::text),
          ('accounts', 'eligibility_status', 'text', true, '''UNKNOWN''::text'),
          ('accounts', 'created_at', 'timestamp with time zone', true, 'statement_timestamp()'),
          ('account_profiles', 'account_id', 'uuid', true, NULL::text),
          ('account_profiles', 'contact_email', 'text', true, NULL::text),
          ('account_profiles', 'contact_phone', 'text', false, NULL::text),
          (
            'account_profiles',
            'declared_residency_country_code',
            'text',
            true,
            NULL::text
          ),
          ('account_profiles', 'version', 'integer', true, '1'),
          (
            'account_profiles',
            'created_at',
            'timestamp with time zone',
            true,
            'statement_timestamp()'
          ),
          (
            'account_profiles',
            'updated_at',
            'timestamp with time zone',
            true,
            'statement_timestamp()'
          ),
          ('account_profile_audit', 'audit_id', 'uuid', true, 'gen_random_uuid()'),
          ('account_profile_audit', 'account_id', 'uuid', true, NULL::text),
          ('account_profile_audit', 'actor_account_id', 'uuid', true, NULL::text),
          ('account_profile_audit', 'correlation_id', 'text', true, NULL::text),
          ('account_profile_audit', 'action', 'text', true, NULL::text),
          (
            'account_profile_audit',
            'result',
            'text',
            true,
            '''SUCCEEDED''::text'
          ),
          ('account_profile_audit', 'before_version', 'integer', false, NULL::text),
          ('account_profile_audit', 'after_version', 'integer', true, NULL::text),
          ('account_profile_audit', 'changed_fields', 'text[]', true, NULL::text),
          (
            'account_profile_audit',
            'occurred_at',
            'timestamp with time zone',
            true,
            'statement_timestamp()'
          )
      ) AS expected(table_name, column_name, data_type, is_not_null, default_expression)
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = to_regclass(expected.table_name)
       AND attribute.attname = expected.column_name
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef AS column_default
        ON column_default.adrelid = attribute.attrelid
       AND column_default.adnum = attribute.attnum
      WHERE pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
              IS DISTINCT FROM expected.data_type
         OR attribute.attnotnull IS DISTINCT FROM expected.is_not_null
         OR pg_catalog.pg_get_expr(column_default.adbin, column_default.adrelid)
              IS DISTINCT FROM expected.default_expression
    )
    AND (
      SELECT lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%new.account_id%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%old.account_id%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%new.eligibility_status%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%old.eligibility_status%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%new.created_at%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%old.created_at%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%raise exception%'
      FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure('enforce_account_immutability()')
    )
    AND (
      SELECT lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%old.version + 1%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%new.version%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%new.updated_at%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%old.updated_at%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%greatest%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%statement_timestamp%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%raise exception%'
      FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure('enforce_account_profile_update()')
    )
    AND (
      SELECT lower(pg_catalog.pg_get_functiondef(oid))
        LIKE '%account profile audit records are append-only%'
        AND lower(pg_catalog.pg_get_functiondef(oid)) LIKE '%raise exception%'
      FROM pg_catalog.pg_proc
      WHERE oid = to_regprocedure('reject_account_profile_audit_mutation()')
    )
    AND (
      SELECT procedure.prosecdef
        AND procedure.proowner = account_table.relowner
        AND procedure.prokind = 'f'
        AND procedure.provolatile = 'v'
        AND procedure.proparallel = 'u'
        AND procedure.proretset
        AND NOT procedure.proisstrict
        AND NOT procedure.proleakproof
        AND procedure.prolang = (
          SELECT language.oid
          FROM pg_catalog.pg_language AS language
          WHERE language.lanname = 'plpgsql'
        )
        AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
          'requested_account_id uuid, requested_contact_email text, '
          'requested_contact_phone text, requested_residency_country_code text, '
          'requested_actor_account_id uuid, requested_correlation_id text'
        AND pg_catalog.pg_get_function_result(procedure.oid) =
          'TABLE(profile_account_id uuid, profile_contact_email text, '
          'profile_contact_phone text, profile_residency_country_code text, '
          'account_eligibility_status text, profile_version integer, '
          'profile_created_at timestamp with time zone, '
          'profile_updated_at timestamp with time zone)'
        AND procedure.proconfig = ARRAY[
          'search_path=pg_catalog, '
            || pg_catalog.quote_ident(pg_catalog.current_schema())
            || ', pg_temp'
        ]
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%requested_actor_account_id is distinct from requested_account_id%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%insert into accounts%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%insert into account_profiles%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%insert into account_profile_audit%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid)) LIKE '%provisioned%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid)) LIKE '%succeeded%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%get diagnostics profile_insert_count = row_count%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%get diagnostics audit_insert_count = row_count%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%audit_insert_count is distinct from profile_insert_count%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid)) NOT LIKE '%on conflict%'
        AND pg_catalog.md5(procedure.prosrc) = 'b00ae05d2fa7c69f168b816a00036419'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            coalesce(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee = 0
            AND function_acl.privilege_type = 'EXECUTE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            coalesce(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS function_acl
          WHERE function_acl.privilege_type = 'EXECUTE'
            AND function_acl.grantee <> procedure.proowner
            AND function_acl.grantee IS DISTINCT FROM (
              SELECT runtime_role.oid
              FROM pg_catalog.pg_roles AS runtime_role
              WHERE runtime_role.rolname = 'crypto_runtime'
            )
        )
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_class AS account_table
        ON account_table.oid = to_regclass('accounts')
      WHERE procedure.oid = to_regprocedure(
        'provision_account_profile(uuid,text,text,text,uuid,text)'
      )
    )
    AND (
      SELECT procedure.prosecdef
        AND procedure.proowner = profile_table.relowner
        AND procedure.prokind = 'f'
        AND procedure.provolatile = 'v'
        AND procedure.proparallel = 'u'
        AND procedure.proretset
        AND NOT procedure.proisstrict
        AND NOT procedure.proleakproof
        AND procedure.prolang = (
          SELECT language.oid
          FROM pg_catalog.pg_language AS language
          WHERE language.lanname = 'plpgsql'
        )
        AND pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
          'requested_account_id uuid, requested_expected_version integer, '
          'requested_has_contact_email boolean, requested_contact_email text, '
          'requested_has_contact_phone boolean, requested_contact_phone text, '
          'requested_has_residency_country_code boolean, '
          'requested_residency_country_code text, requested_actor_account_id uuid, '
          'requested_correlation_id text'
        AND pg_catalog.pg_get_function_result(procedure.oid) =
          'TABLE(update_outcome text, profile_account_id uuid, '
          'profile_contact_email text, profile_contact_phone text, '
          'profile_residency_country_code text, account_eligibility_status text, '
          'profile_version integer, profile_created_at timestamp with time zone, '
          'profile_updated_at timestamp with time zone)'
        AND procedure.proconfig = ARRAY[
          'search_path=pg_catalog, '
            || pg_catalog.quote_ident(pg_catalog.current_schema())
            || ', pg_temp'
        ]
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%requested_actor_account_id is distinct from requested_account_id%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%profile.version = requested_expected_version%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%insert into account_profile_audit%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%updated_profile.version - 1%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid)) LIKE '%array_remove%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid)) LIKE '%stale%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid)) LIKE '%not-found%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%get diagnostics profile_update_count = row_count%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%get diagnostics audit_insert_count = row_count%'
        AND lower(pg_catalog.pg_get_functiondef(procedure.oid))
              LIKE '%audit_insert_count is distinct from profile_update_count%'
        AND pg_catalog.md5(procedure.prosrc) = '2eeaac562fa8c19075b4e8ac560fe2c0'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            coalesce(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS function_acl
          WHERE function_acl.grantee = 0
            AND function_acl.privilege_type = 'EXECUTE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            coalesce(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS function_acl
          WHERE function_acl.privilege_type = 'EXECUTE'
            AND function_acl.grantee <> procedure.proowner
            AND function_acl.grantee IS DISTINCT FROM (
              SELECT runtime_role.oid
              FROM pg_catalog.pg_roles AS runtime_role
              WHERE runtime_role.rolname = 'crypto_runtime'
            )
        )
      FROM pg_catalog.pg_proc AS procedure
      INNER JOIN pg_catalog.pg_class AS profile_table
        ON profile_table.oid = to_regclass('account_profiles')
      WHERE procedure.oid = to_regprocedure(
        'update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'
      )
    )
    AND (
      SELECT count(*) = 3
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('accounts')
        AND conname IN (
          'accounts_pkey',
          'accounts_account_id_uuid_v4_check',
          'accounts_eligibility_unknown_check'
        )
        AND convalidated
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('accounts')
        AND conname = 'accounts_account_id_uuid_v4_check'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%substring%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''4''%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''8''%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''b''%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('accounts')
        AND conname = 'accounts_eligibility_unknown_check'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%UNKNOWN%'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%eligibility_status%'
    )
    AND (
      SELECT count(*) = 7
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profiles')
        AND conname IN (
          'account_profiles_pkey',
          'account_profiles_account_fk',
          'account_profiles_contact_email_check',
          'account_profiles_contact_phone_check',
          'account_profiles_country_check',
          'account_profiles_version_check',
          'account_profiles_timestamps_check'
        )
        AND convalidated
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profiles')
        AND conname = 'account_profiles_contact_email_check'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%octet_length%'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%replace%'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%split_part%'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%translate%'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%lower%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profiles')
        AND conname = 'account_profiles_contact_phone_check'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%contact_phone%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%{1,14}%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profiles')
        AND conname = 'account_profiles_country_check'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%declared_residency_country_code%'
        AND (
          SELECT pg_catalog.array_agg(country_match[1] ORDER BY country_match[1])
          FROM pg_catalog.regexp_matches(
            pg_catalog.pg_get_constraintdef(oid),
            '''([A-Z]{2})''',
            'g'
          ) AS country_match
        ) = ARRAY[${ISO_3166_ALPHA_2_SQL}]
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profiles')
        AND conname = 'account_profiles_version_check'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%version > 0%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profiles')
        AND conname = 'account_profiles_account_fk'
        AND contype = 'f'
        AND confrelid = to_regclass('accounts')
        AND confupdtype = 'r'
        AND confdeltype = 'r'
    )
    AND (
      SELECT count(*) = 9
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profile_audit')
        AND conname IN (
          'account_profile_audit_pkey',
          'account_profile_audit_id_uuid_v4_check',
          'account_profile_audit_account_fk',
          'account_profile_audit_actor_fk',
          'account_profile_audit_correlation_check',
          'account_profile_audit_action_check',
          'account_profile_audit_result_check',
          'account_profile_audit_version_transition_check',
          'account_profile_audit_changed_fields_check'
        )
        AND convalidated
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profile_audit')
        AND conname = 'account_profile_audit_changed_fields_check'
        AND lower(pg_catalog.pg_get_constraintdef(oid)) LIKE '%cardinality%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%contactEmail%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%contactPhone%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%declaredResidencyCountryCode%'
    )
    AND (
      SELECT count(*) = 2
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profile_audit')
        AND conname IN ('account_profile_audit_account_fk', 'account_profile_audit_actor_fk')
        AND contype = 'f'
        AND confrelid = to_regclass('accounts')
        AND confupdtype = 'r'
        AND confdeltype = 'r'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profile_audit')
        AND conname = 'account_profile_audit_action_check'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%PROVISIONED%'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%UPDATED%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('account_profile_audit')
        AND conname = 'account_profile_audit_result_check'
        AND pg_catalog.pg_get_constraintdef(oid) LIKE '%SUCCEEDED%'
    )
    AND (
      SELECT count(*) = 1
      FROM pg_catalog.pg_trigger
      WHERE tgrelid = to_regclass('accounts')
        AND tgname = 'accounts_immutable_fields_trigger'
        AND tgfoid = to_regprocedure('enforce_account_immutability()')
        AND tgtype = 19
        AND tgenabled IN ('O', 'A')
        AND NOT tgisinternal
    )
    AND (
      SELECT count(*) = 1
      FROM pg_catalog.pg_trigger
      WHERE tgrelid = to_regclass('account_profiles')
        AND tgname = 'account_profiles_managed_update_trigger'
        AND tgfoid = to_regprocedure('enforce_account_profile_update()')
        AND tgtype = 19
        AND tgenabled IN ('O', 'A')
        AND NOT tgisinternal
    )
    AND (
      SELECT count(*) = 2 FROM pg_catalog.pg_trigger
      WHERE tgrelid = to_regclass('account_profile_audit')
        AND tgname IN (
          'account_profile_audit_append_only_row_trigger',
          'account_profile_audit_append_only_truncate_trigger'
        )
        AND tgfoid = to_regprocedure('reject_account_profile_audit_mutation()')
        AND (
          (
            tgname = 'account_profile_audit_append_only_row_trigger'
            AND tgtype = 27
          )
          OR (
            tgname = 'account_profile_audit_append_only_truncate_trigger'
            AND tgtype = 34
          )
        )
        AND tgenabled IN ('O', 'A')
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index
      INNER JOIN pg_catalog.pg_class AS index_class ON index_class.oid = indexrelid
      WHERE indrelid = to_regclass('account_profile_audit')
        AND index_class.relname = 'account_profile_audit_account_timeline_idx'
        AND indisvalid
        AND indisready
        AND pg_catalog.pg_get_indexdef(indexrelid)
          LIKE '%(account_id, occurred_at, audit_id)'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_index
      INNER JOIN pg_catalog.pg_class AS index_class ON index_class.oid = indexrelid
      WHERE indrelid = to_regclass('account_profile_audit')
        AND index_class.relname = 'account_profile_audit_correlation_idx'
        AND indisvalid
        AND indisready
        AND pg_catalog.pg_get_indexdef(indexrelid)
          LIKE '%(correlation_id, occurred_at, audit_id)'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (
        VALUES
          (to_regclass('accounts')),
          (to_regclass('account_profiles')),
          (to_regclass('account_profile_audit'))
      ) AS protected_table(table_oid)
      INNER JOIN pg_catalog.pg_class AS table_class
        ON table_class.oid = protected_table.table_oid
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(
          table_class.relacl,
          pg_catalog.acldefault('r', table_class.relowner)
        )
      ) AS table_acl
      WHERE table_acl.grantee = 0
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS runtime_role
      WHERE runtime_role.rolname = 'crypto_runtime'
        AND (
          NOT pg_catalog.has_schema_privilege(
            runtime_role.oid,
            pg_catalog.current_schema(),
            'USAGE'
          )
          OR pg_catalog.has_schema_privilege(
            runtime_role.oid,
            pg_catalog.current_schema(),
            'CREATE'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS runtime_schema
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              coalesce(
                runtime_schema.nspacl,
                pg_catalog.acldefault('n', runtime_schema.nspowner)
              )
            ) AS schema_acl
            WHERE runtime_schema.nspname = pg_catalog.current_schema()
              AND schema_acl.grantee = runtime_role.oid
              AND schema_acl.is_grantable
          )
          OR NOT pg_catalog.has_table_privilege(runtime_role.oid, 'accounts', 'SELECT')
          OR pg_catalog.has_table_privilege(runtime_role.oid, 'accounts', 'INSERT')
          OR pg_catalog.has_table_privilege(runtime_role.oid, 'accounts', 'UPDATE')
          OR pg_catalog.has_table_privilege(runtime_role.oid, 'accounts', 'DELETE')
          OR pg_catalog.has_table_privilege(runtime_role.oid, 'accounts', 'TRUNCATE')
          OR pg_catalog.has_table_privilege(runtime_role.oid, 'accounts', 'REFERENCES')
          OR pg_catalog.has_table_privilege(runtime_role.oid, 'accounts', 'TRIGGER')
          OR NOT pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profiles',
            'SELECT'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profiles',
            'INSERT'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profiles',
            'UPDATE'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profiles',
            'DELETE'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profiles',
            'TRUNCATE'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profiles',
            'REFERENCES'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profiles',
            'TRIGGER'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profile_audit',
            'SELECT'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profile_audit',
            'INSERT'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profile_audit',
            'UPDATE'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profile_audit',
            'DELETE'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profile_audit',
            'TRUNCATE'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profile_audit',
            'REFERENCES'
          )
          OR pg_catalog.has_table_privilege(
            runtime_role.oid,
            'account_profile_audit',
            'TRIGGER'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class AS protected_runtime_table
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              coalesce(
                protected_runtime_table.relacl,
                pg_catalog.acldefault('r', protected_runtime_table.relowner)
              )
            ) AS table_acl
            WHERE protected_runtime_table.oid IN (
              to_regclass('accounts'),
              to_regclass('account_profiles'),
              to_regclass('account_profile_audit')
            )
              AND table_acl.grantee = runtime_role.oid
              AND table_acl.is_grantable
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_attribute AS protected_column
            WHERE protected_column.attrelid IN (
              to_regclass('accounts'),
              to_regclass('account_profiles')
            )
              AND protected_column.attnum > 0
              AND NOT protected_column.attisdropped
              AND (
                pg_catalog.has_column_privilege(
                  runtime_role.oid,
                  protected_column.attrelid,
                  protected_column.attnum,
                  'INSERT'
                )
                OR pg_catalog.has_column_privilege(
                  runtime_role.oid,
                  protected_column.attrelid,
                  protected_column.attnum,
                  'UPDATE'
                )
                OR pg_catalog.has_column_privilege(
                  runtime_role.oid,
                  protected_column.attrelid,
                  protected_column.attnum,
                  'REFERENCES'
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_attribute AS audit_column
            WHERE audit_column.attrelid = to_regclass('account_profile_audit')
              AND audit_column.attnum > 0
              AND NOT audit_column.attisdropped
              AND (
                pg_catalog.has_column_privilege(
                  runtime_role.oid,
                  audit_column.attrelid,
                  audit_column.attnum,
                  'SELECT'
                )
                OR pg_catalog.has_column_privilege(
                  runtime_role.oid,
                  audit_column.attrelid,
                  audit_column.attnum,
                  'INSERT'
                )
                OR pg_catalog.has_column_privilege(
                  runtime_role.oid,
                  audit_column.attrelid,
                  audit_column.attnum,
                  'UPDATE'
                )
                OR pg_catalog.has_column_privilege(
                  runtime_role.oid,
                  audit_column.attrelid,
                  audit_column.attnum,
                  'REFERENCES'
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_attribute AS protected_runtime_column
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              protected_runtime_column.attacl
            ) AS column_acl
            WHERE protected_runtime_column.attrelid IN (
              to_regclass('accounts'),
              to_regclass('account_profiles'),
              to_regclass('account_profile_audit')
            )
              AND protected_runtime_column.attnum > 0
              AND NOT protected_runtime_column.attisdropped
              AND column_acl.grantee = runtime_role.oid
              AND column_acl.is_grantable
          )
          OR NOT pg_catalog.has_function_privilege(
            runtime_role.oid,
            to_regprocedure('provision_account_profile(uuid,text,text,text,uuid,text)'),
            'EXECUTE'
          )
          OR NOT pg_catalog.has_function_privilege(
            runtime_role.oid,
            to_regprocedure(
              'update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'
            ),
            'EXECUTE'
          )
          OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc AS runtime_function
            CROSS JOIN LATERAL pg_catalog.aclexplode(
              coalesce(
                runtime_function.proacl,
                pg_catalog.acldefault('f', runtime_function.proowner)
              )
            ) AS function_acl
            WHERE runtime_function.oid IN (
              to_regprocedure('provision_account_profile(uuid,text,text,text,uuid,text)'),
              to_regprocedure(
                'update_account_profile(uuid,integer,boolean,text,boolean,text,boolean,text,uuid,text)'
              )
            )
              AND function_acl.grantee = runtime_role.oid
              AND function_acl.is_grantable
          )
          OR pg_catalog.has_function_privilege(
            runtime_role.oid,
            to_regprocedure('enforce_account_immutability()'),
            'EXECUTE'
          )
          OR pg_catalog.has_function_privilege(
            runtime_role.oid,
            to_regprocedure('enforce_account_profile_update()'),
            'EXECUTE'
          )
          OR pg_catalog.has_function_privilege(
            runtime_role.oid,
            to_regprocedure('reject_account_profile_audit_mutation()'),
            'EXECUTE'
          )
        )
    )
  ) AS valid`,
};
