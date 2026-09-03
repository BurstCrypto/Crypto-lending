import {
  SmartLendingExternalFeedConfigurationError,
  loadSmartLendingExternalFeedConfig,
} from './smart-lending-external-feed.config';
import { SmartLendingExternalFeedDestination } from './smart-lending-external-feed.types';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SOURCE_REVISION = 'c'.repeat(40);

function approvalBinding(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
    SMART_LENDING_EXTERNAL_FEEDS_EGRESS_APPROVAL_REFERENCE_ID: 'approval:egress:v1',
    SMART_LENDING_EXTERNAL_FEEDS_EGRESS_POLICY_SHA256: SHA_A,
    SMART_LENDING_EXTERNAL_FEEDS_PROVIDER_APPROVAL_REFERENCE_ID: 'approval:providers:v1',
    SMART_LENDING_EXTERNAL_FEEDS_PROVIDER_POLICY_SHA256: SHA_B,
    SMART_LENDING_EXTERNAL_FEEDS_SOURCE_REVISION: SOURCE_REVISION,
  };
}

describe('loadSmartLendingExternalFeedConfig', () => {
  it('is disabled by default', () => {
    expect(loadSmartLendingExternalFeedConfig({})).toEqual({ mode: 'disabled' });
  });

  it('rejects subordinate configuration while globally disabled', () => {
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        SMART_LENDING_EXTERNAL_FEEDS_MODE: 'disabled',
        SMART_LENDING_AAVE_V3_KILL_SWITCH: 'off',
      }),
    ).toThrow(SmartLendingExternalFeedConfigurationError);
  });

  it.each([
    'SMART_LENDING_AAVE_V3_URL',
    'SMART_LENDING_DEFILLAMA_URL',
    'SMART_LENDING_LIFI_ENDPOINT',
    'SMART_LENDING_EXTERNAL_FEEDS_PROXY_ORIGIN',
  ])('rejects unreviewed endpoint-like variable %s', (name) => {
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
        [name]: 'https://attacker.invalid',
      }),
    ).toThrow(
      expect.objectContaining<Partial<SmartLendingExternalFeedConfigurationError>>({ field: name }),
    );
  });

  it.each([
    'SMART_LENDING_AAVE_V3_PRIVATE_KEY',
    'SMART_LENDING_LIFI_PRIVATE_KEY',
    'SMART_LENDING_DEFILLAMA_SIGNER_KEY',
    'SMART_LENDING_EXTERNAL_FEEDS_MNEMONIC',
    'SMART_LENDING_EXTERNAL_FEEDS_SOLANA_KEYPAIR',
  ])('rejects signer material variable %s without inspecting its value', (name) => {
    const secret = 'do-not-emit-this-secret';
    try {
      loadSmartLendingExternalFeedConfig({ [name]: secret });
      throw new Error('expected configuration rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(SmartLendingExternalFeedConfigurationError);
      expect(String(error)).not.toContain(secret);
    }
  });

  it('keeps every destination kill switch active by default when enabled', () => {
    expect(
      loadSmartLendingExternalFeedConfig({
        NODE_ENV: 'test',
        SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
      }),
    ).toEqual({
      mode: 'enabled',
      approval: null,
      lifiApiKey: null,
      killSwitches: {
        [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: true,
        [SmartLendingExternalFeedDestination.DefiLlamaYields]: true,
        [SmartLendingExternalFeedDestination.LifiQuote]: true,
      },
    });
  });

  it('allows the Aave destination to be enabled independently and accepts a server API key', () => {
    const config = loadSmartLendingExternalFeedConfig({
      ...approvalBinding(),
      SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
      SMART_LENDING_AAVE_V3_KILL_SWITCH: 'off',
      SMART_LENDING_DEFILLAMA_KILL_SWITCH: 'on',
      SMART_LENDING_LIFI_KILL_SWITCH: 'on',
      SMART_LENDING_LIFI_API_KEY: 'server-api-key',
    });
    expect(config).toMatchObject({
      mode: 'enabled',
      lifiApiKey: 'server-api-key',
      killSwitches: {
        [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: false,
        [SmartLendingExternalFeedDestination.DefiLlamaYields]: true,
        [SmartLendingExternalFeedDestination.LifiQuote]: true,
      },
    });
  });

  it('rejects invalid kill-switch and API-key forms', () => {
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
        SMART_LENDING_LIFI_KILL_SWITCH: 'false',
      }),
    ).toThrow(SmartLendingExternalFeedConfigurationError);
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
        SMART_LENDING_LIFI_API_KEY: ' secret-key',
      }),
    ).toThrow(SmartLendingExternalFeedConfigurationError);
  });

  it('requires the complete evidence binding before any non-production destination is active', () => {
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        NODE_ENV: 'development',
        SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
        SMART_LENDING_AAVE_V3_KILL_SWITCH: 'off',
      }),
    ).toThrow(
      expect.objectContaining<Partial<SmartLendingExternalFeedConfigurationError>>({
        field: 'SMART_LENDING_EXTERNAL_FEEDS_APPROVAL_BINDING',
      }),
    );
  });

  it('loads complete immutable approval evidence for a non-production exercise', () => {
    expect(loadSmartLendingExternalFeedConfig(approvalBinding())).toMatchObject({
      mode: 'enabled',
      approval: {
        egressApprovalReferenceId: 'approval:egress:v1',
        egressPolicySha256: SHA_A,
        providerApprovalReferenceId: 'approval:providers:v1',
        providerPolicySha256: SHA_B,
        sourceRevision: SOURCE_REVISION,
      },
    });
  });

  it('rejects production activation even when evidence-shaped bindings are complete', () => {
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        ...approvalBinding(),
        NODE_ENV: 'production',
        SMART_LENDING_AAVE_V3_KILL_SWITCH: 'off',
      }),
    ).toThrow(
      expect.objectContaining<Partial<SmartLendingExternalFeedConfigurationError>>({
        field: 'SMART_LENDING_EXTERNAL_FEEDS_PRODUCTION_ACTIVATION',
      }),
    );
  });

  it.each([undefined, 'prod', 'staging', 'development '])(
    'rejects enabled mode for an absent or nonstandard NODE_ENV (%s)',
    (nodeEnvironment) => {
      expect(() =>
        loadSmartLendingExternalFeedConfig({
          ...approvalBinding(),
          NODE_ENV: nodeEnvironment,
        }),
      ).toThrow(
        expect.objectContaining<Partial<SmartLendingExternalFeedConfigurationError>>({
          field: 'SMART_LENDING_EXTERNAL_FEEDS_NON_PRODUCTION_ENVIRONMENT',
        }),
      );
    },
  );

  it('rejects partial or malformed approval bindings', () => {
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        SMART_LENDING_EXTERNAL_FEEDS_MODE: 'enabled',
        SMART_LENDING_EXTERNAL_FEEDS_EGRESS_APPROVAL_REFERENCE_ID: 'approval:egress:v1',
      }),
    ).toThrow(SmartLendingExternalFeedConfigurationError);

    expect(() =>
      loadSmartLendingExternalFeedConfig({
        ...approvalBinding(),
        SMART_LENDING_EXTERNAL_FEEDS_PROVIDER_POLICY_SHA256: SHA_B.toUpperCase(),
      }),
    ).toThrow(SmartLendingExternalFeedConfigurationError);
    expect(() =>
      loadSmartLendingExternalFeedConfig({
        ...approvalBinding(),
        SMART_LENDING_EXTERNAL_FEEDS_SOURCE_REVISION: 'main',
      }),
    ).toThrow(SmartLendingExternalFeedConfigurationError);
  });
});
