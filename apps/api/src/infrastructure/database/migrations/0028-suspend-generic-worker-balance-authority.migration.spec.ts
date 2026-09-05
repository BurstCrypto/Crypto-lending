import {
  createGenericWorkerBalanceAuthoritySuspensionMigration,
  PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
  suspendGenericWorkerBalanceAuthorityMigrationV0028,
  suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028,
} from './0028-suspend-generic-worker-balance-authority.migration';

function sql(value: string | readonly string[]): string {
  return Array.isArray(value) ? value.join('\n') : (value as string);
}

function countOccurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

const suspendedFunctions = [
  'read_balance_sync_checkpoint(uuid,uuid,text)',
  'record_balance_sync_current(uuid,uuid,text,bigint,text,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
  'mark_balance_sync_checkpoint_stale(uuid,uuid,text,bigint,timestamp with time zone,text)',
  'replace_balance_sync_after_reorg(uuid,uuid,text,bigint,numeric,text,text,text,timestamp with time zone,text,numeric,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,timestamp with time zone)',
  'resolve_active_wallet_address_ciphertext(uuid,uuid,text)',
] as const;

describe('migration 0028 generic worker balance authority suspension', () => {
  it('extends 0027 as a forward-only dormant authority removal', () => {
    const migration = suspendGenericWorkerBalanceAuthorityMigrationV0028;

    expect(migration.id).toBe('0028');
    expect(migration.supersedesVerificationOf).toEqual(['0027']);
    expect(migration.transactional).not.toBe(false);
    expect(migration.description).toContain('without activating the consumer');
  });

  it('revokes exactly the four checkpoint functions and wallet resolver from only the worker', () => {
    const up = sql(suspendGenericWorkerBalanceAuthorityMigrationV0028.upSql);

    expect(up.match(/REVOKE EXECUTE ON FUNCTION/gu)).toHaveLength(5);
    for (const functionIdentity of suspendedFunctions) {
      expect(countOccurrences(up, functionIdentity)).toBe(1);
      expect(up).toContain(
        `REVOKE EXECUTE ON FUNCTION ${functionIdentity} FROM "crypto_worker_runtime";`,
      );
    }
    expect(up).not.toContain('GRANT');
    expect(up).not.toContain('crypto_balance_consumer_runtime');
    expect(up).not.toContain('crypto_balance_consumer_login_');
    expect(up).not.toContain('read_balance_sync_portfolio');
    expect(up).not.toContain('record_balance_sync_finalized_anchor');
    expect(up).not.toContain('persist_balance_sync_observation');
  });

  it('rewrites each exact 0027 worker expectation and denies direct function ACLs', () => {
    const verifier = suspendGenericWorkerBalanceAuthorityMigrationV0028.verifySql ?? '';

    for (const functionIdentity of suspendedFunctions) {
      const privilege = `pg_catalog.has_function_privilege('crypto_worker_runtime', '${functionIdentity}', 'EXECUTE')`;
      expect(countOccurrences(verifier, privilege)).toBe(2);
      expect(countOccurrences(verifier, `NOT ${privilege}`)).toBe(2);
    }
    expect(verifier).toContain(`SELECT pg_catalog.count(*) = 0
          FROM pg_catalog.pg_proc AS procedure
          INNER JOIN pg_catalog.pg_namespace AS namespace`);
    expect(verifier).not.toContain(`SELECT pg_catalog.count(*) = 1
            AND pg_catalog.bool_and(grantee.rolname = 'crypto_worker_runtime')
            AND pg_catalog.bool_and(acl.privilege_type = 'EXECUTE')`);
    expect(verifier).toContain("AND grantee.rolname = 'crypto_worker_runtime'");
  });

  it('keeps the production balance capability and every bounded login slot dormant', () => {
    const verifier = suspendGenericWorkerBalanceAuthorityMigrationV0028.verifySql ?? '';

    for (const marker of [
      "role.rolname = 'crypto_balance_consumer_runtime'",
      "role.rolname ~ ('^' || 'crypto_balance_consumer_login_' || '[a-z0-9]{1,32}$')",
      'SELECT pg_catalog.count(*) BETWEEN 1 AND 2',
      'AND NOT membership.admin_option',
      'AND NOT membership.inherit_option',
      'AND membership.set_option',
      "pg_catalog.has_database_privilege(audited_role.oid, database.oid, 'CONNECT')",
      'CROSS JOIN LATERAL pg_catalog.aclexplode(database.datacl)',
      'CROSS JOIN LATERAL pg_catalog.aclexplode(namespace.nspacl)',
      'CROSS JOIN LATERAL pg_catalog.aclexplode(object.relacl)',
      'CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)',
      'CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl)',
      'CROSS JOIN LATERAL pg_catalog.aclexplode(type_object.typacl)',
      'FROM pg_catalog.pg_default_acl AS owned_defaults',
      'default_owner.oid = owned_defaults.defaclrole',
      'CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl)',
    ]) {
      expect(verifier).toContain(marker);
    }
  });

  it('binds capability members to the literal prefix and audits empty default ACL owners', () => {
    const verifier = suspendGenericWorkerBalanceAuthorityMigrationV0028.verifySql ?? '';

    expect(verifier).toContain(
      `pg_catalog.left(member_role.rolname, pg_catalog.length('crypto_balance_consumer_login_')) = 'crypto_balance_consumer_login_'
              AND member_role.rolname ~`,
    );
    const ownerAudit = verifier.indexOf('FROM pg_catalog.pg_default_acl AS owned_defaults');
    const explodedGrantAudit = verifier.indexOf(
      'CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl)',
      ownerAudit,
    );
    expect(ownerAudit).toBeGreaterThanOrEqual(0);
    expect(explodedGrantAudit).toBeGreaterThan(ownerAudit);
  });

  it('shares the exact revocation while isolating cluster-global principal verification', () => {
    expect(suspendGenericWorkerBalanceAuthorityMigrationV0028.upSql).toEqual(
      suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028.upSql,
    );
    expect(suspendGenericWorkerBalanceAuthorityMigrationV0028.downSql).toEqual(
      suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028.downSql,
    );
    expect(suspendGenericWorkerBalanceAuthorityMigrationV0028.verifySql).not.toEqual(
      suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028.verifySql,
    );
    expect(suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028.verifySql).toContain(
      'SELECT true AS valid',
    );
    expect(suspendGenericWorkerBalanceAuthorityTestSchemaMigrationV0028.verifySql).not.toContain(
      'crypto_balance_consumer_runtime',
    );
  });

  it('rejects malformed, aliased, and cross-scoped balance principal identities', () => {
    expect(() =>
      createGenericWorkerBalanceAuthoritySuspensionMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        balanceConsumerRuntimeRole: 'unsafe-role',
      }),
    ).toThrow('balanceConsumerRuntimeRole');
    expect(() =>
      createGenericWorkerBalanceAuthoritySuspensionMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        balanceConsumerLoginPrefix: 'unsafe-prefix_',
      }),
    ).toThrow('balanceConsumerLoginPrefix');
    expect(() =>
      createGenericWorkerBalanceAuthoritySuspensionMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        balanceConsumerRuntimeRole: PRODUCTION_BALANCE_CONSUMER_PRINCIPALS.workerRuntimeRole,
      }),
    ).toThrow('must be distinct');
    expect(() =>
      createGenericWorkerBalanceAuthoritySuspensionMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        balanceConsumerLoginPrefix: PRODUCTION_BALANCE_CONSUMER_PRINCIPALS.apiLoginPrefix,
      }),
    ).toThrow('must be disjoint');
    expect(() =>
      createGenericWorkerBalanceAuthoritySuspensionMigration({
        ...PRODUCTION_BALANCE_CONSUMER_PRINCIPALS,
        schemaOwnerRole: 'unsafe-role',
      }),
    ).toThrow('schemaOwnerRole');
  });

  it('refuses rollback with SQLSTATE 55000 and never regrants authority', () => {
    const down = sql(suspendGenericWorkerBalanceAuthorityMigrationV0028.downSql);

    expect(down).toContain("USING ERRCODE = '55000'");
    expect(down).toContain('cannot roll back suspended generic worker balance authority');
    expect(down).not.toContain('GRANT');
    expect(down).not.toContain('REVOKE');
  });
});
