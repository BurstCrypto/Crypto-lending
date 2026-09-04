import {
  createStablecoinPriceEvidenceReadModelMigration,
  createStablecoinPriceEvidenceReadModelMigrationV0021,
  createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021,
} from './0021-create-stablecoin-price-evidence-read-model.migration';

function sql(value: string | readonly string[]): string {
  return typeof value === 'string' ? value : value.join('\n');
}

describe('migration 0021 stablecoin price evidence read model', () => {
  it('creates normalized immutable evidence, observations, transitions, and watermarks', () => {
    const migration = createStablecoinPriceEvidenceReadModelMigrationV0021;
    const up = sql(migration.upSql);

    expect(migration.id).toBe('0021');
    expect(migration.supersedesVerificationOf).toEqual(['0020']);
    for (const table of [
      'stablecoin_price_source_registry',
      'stablecoin_price_evidence',
      'stablecoin_price_observations',
      'stablecoin_price_watermark_events',
      'stablecoin_price_source_watermarks',
    ]) {
      expect(up).toContain(`CREATE TABLE ${table}`);
    }
    expect(up).toContain('stablecoin_price_observation_update_unique');
    expect(up).toContain('stablecoin_price_event_revision_unique');
    expect(up).toContain('stablecoin_price_watermark_transition');
    expect(up).toContain('ENABLE ALWAYS TRIGGER');
    expect(up).not.toContain('DELETE FROM stablecoin_price_');
  });

  it('pins only the six Ethereum/Solana assets and two policy sources', () => {
    const up = sql(createStablecoinPriceEvidenceReadModelMigrationV0021.upSql);

    expect(up).toContain('5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d');
    expect(up).toContain("network_id = 'eip155:1'");
    expect(up).toContain("network_id = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'");
    expect(up).not.toContain('eip155:8453');
    expect(up).not.toContain('eip155:42161');
    expect(up).toContain("source_id = 'PYTH_CORE'");
    expect(up).toContain("source_id = 'CHAINLINK_DATA_FEEDS'");
    expect(up).toContain('eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a');
    expect(up).toContain('pyusd-usd.data.eth');
  });

  it('returns each latest observation with its prior watermark, not its own update ID', () => {
    const up = sql(createStablecoinPriceEvidenceReadModelMigrationV0021.upSql);

    expect(up).toContain('event.previous_sequence');
    expect(up).toContain('event.previous_update_id');
    expect(up).toContain('event.previous_priced_at');
    expect(up).toContain('event.previous_observed_at');
    expect(up).toContain('ORDER BY event.revision DESC');
    expect(up).toContain('event.accepted_at <= requested_evaluated_at');
    expect(up).not.toMatch(/last_accepted_update_id::text AS previous_update_id/u);
  });

  it('grants API read and worker write only through fixed-path security definer functions', () => {
    const up = sql(createStablecoinPriceEvidenceReadModelMigrationV0021.upSql);

    expect(up).toContain('LANGUAGE plpgsql SECURITY DEFINER STABLE PARALLEL UNSAFE');
    expect(up).toContain('LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE');
    expect(up).toContain('SET search_path TO pg_catalog, %I, pg_temp');
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION read_stablecoin_price_evidence(text,smallint,text,text,text,text,smallint,timestamp with time zone) TO "crypto_api_runtime"',
    );
    expect(up).toContain(
      'GRANT EXECUTE ON FUNCTION record_stablecoin_price_evidence(uuid,text,text,timestamp with time zone,text,text,text,smallint,text,text,text,text,smallint,text,text,numeric,text,timestamp with time zone,timestamp with time zone,numeric,smallint,text,numeric,smallint,text,text,text) TO "crypto_worker_runtime"',
    );
    expect(up).not.toMatch(/GRANT (?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE) ON/u);
    expect(up).toContain('REVOKE ALL PRIVILEGES ON TYPE stablecoin_price_source_registry');
  });

  it('verifies exact objects, immutable catalog manifest, ACLs, triggers, and uniqueness', () => {
    const production = createStablecoinPriceEvidenceReadModelMigrationV0021;
    const isolated = createStablecoinPriceEvidenceReadModelTestSchemaMigrationV0021;

    expect(production.upSql).toEqual(isolated.upSql);
    expect(production.downSql).toEqual(isolated.downSql);
    expect(production.verifySql).not.toEqual(isolated.verifySql);
    expect(production.verifySql).toContain('crypto-lending:stablecoin-price-sources:MAINNET:v1:');
    expect(production.verifySql).toContain('stablecoin_price_source_registry_exact_check');
    expect(production.verifySql).not.toContain(
      'FROM stablecoin_price_source_registry AS catalog_state',
    );
    expect(isolated.verifySql).toContain('pg_catalog.count(*) = 12');
    for (const verifier of [production.verifySql ?? '', isolated.verifySql ?? '']) {
      expect(verifier).toContain('pg_catalog.count(*) = 11');
      expect(verifier).toContain(
        "function_state.oid IN (\n          pg_catalog.to_regprocedure('read_stablecoin_price_evidence(text,smallint,text,text,text,text,smallint,timestamp with time zone)')",
      );
      expect(verifier).toContain(
        "('stablecoin_price_source_watermarks', 'stablecoin_price_watermark_transition', 'enforce_stablecoin_price_watermark_projection()', 23)",
      );
      expect(verifier).toContain(
        'trigger_state.tgfoid =\n            pg_catalog.to_regprocedure(expected_triggers.function_identity)',
      );
      expect(verifier).toContain('trigger_state.tgtype = expected_triggers.trigger_type');
      expect(verifier).toContain('stablecoin_price_observation_update_unique');
      expect(verifier).toContain(
        "NOT pg_catalog.has_function_privilege('crypto_worker_runtime', 'read_stablecoin_price_evidence",
      );
      expect(verifier).toContain(
        "NOT pg_catalog.has_function_privilege('crypto_api_runtime', 'record_stablecoin_price_evidence",
      );
      expect(verifier).toContain("pg_catalog.acldefault('T', guarded_type.typowner)");
    }
  });

  it('refuses rollback after durable evidence exists', () => {
    const down = sql(createStablecoinPriceEvidenceReadModelMigrationV0021.downSql);

    expect(down).toContain('DO $refuse_stablecoin_price_evidence_history_loss$');
    expect(down).toContain('cannot roll back stablecoin price evidence after use');
    expect(down).not.toContain('DELETE FROM');
  });

  it('rejects unsafe principal identifiers through the cumulative predecessor', () => {
    expect(() =>
      createStablecoinPriceEvidenceReadModelMigration({
        bootstrapRole: 'valid_bootstrap',
        schemaOwnerRole: 'valid_owner',
        migrationRole: 'valid_migration',
        apiRuntimeRole: 'INVALID-API',
        workerRuntimeRole: 'valid_worker',
        apiLoginPrefix: 'valid_api_login_',
        workerLoginPrefix: 'valid_worker_login_',
        legacyRuntimeRole: 'valid_legacy',
      }),
    ).toThrow('apiRuntimeRole');
  });
});
