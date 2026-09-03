import { SmartLendingExternalFeedDestination } from './smart-lending-external-feed.types';

export const SMART_LENDING_EXTERNAL_FEED_CONFIG = Symbol('SMART_LENDING_EXTERNAL_FEED_CONFIG');

export interface SmartLendingExternalFeedApprovalBinding {
  /** Evidence metadata only; it is not a runtime authorization capability. */
  readonly egressApprovalReferenceId: string;
  readonly egressPolicySha256: string;
  readonly providerApprovalReferenceId: string;
  readonly providerPolicySha256: string;
  readonly sourceRevision: string;
}

export type SmartLendingExternalFeedKillSwitches = Readonly<
  Record<SmartLendingExternalFeedDestination, boolean>
>;

export interface DisabledSmartLendingExternalFeedConfig {
  readonly mode: 'disabled';
}

export interface EnabledSmartLendingExternalFeedConfig {
  readonly mode: 'enabled';
  /** `true` means the destination is denied immediately. */
  readonly killSwitches: SmartLendingExternalFeedKillSwitches;
  readonly approval: SmartLendingExternalFeedApprovalBinding | null;
  /** Server-side transport credential. It must never enter a response or log record. */
  readonly lifiApiKey: string | null;
}

export type SmartLendingExternalFeedConfig =
  DisabledSmartLendingExternalFeedConfig | EnabledSmartLendingExternalFeedConfig;

export class SmartLendingExternalFeedConfigurationError extends Error {
  readonly code = 'SMART_LENDING_EXTERNAL_FEED_CONFIGURATION_ERROR' as const;

  constructor(readonly field: string) {
    super(`Invalid smart-lending external-feed configuration: ${field}`);
    this.name = 'SmartLendingExternalFeedConfigurationError';
  }
}

const MODE = 'SMART_LENDING_EXTERNAL_FEEDS_MODE' as const;
const AAVE_V3_KILL_SWITCH = 'SMART_LENDING_AAVE_V3_KILL_SWITCH' as const;
const DEFILLAMA_KILL_SWITCH = 'SMART_LENDING_DEFILLAMA_KILL_SWITCH' as const;
const LIFI_KILL_SWITCH = 'SMART_LENDING_LIFI_KILL_SWITCH' as const;
const LIFI_API_KEY = 'SMART_LENDING_LIFI_API_KEY' as const;
const APPROVAL_VARIABLES = Object.freeze([
  'SMART_LENDING_EXTERNAL_FEEDS_EGRESS_APPROVAL_REFERENCE_ID',
  'SMART_LENDING_EXTERNAL_FEEDS_EGRESS_POLICY_SHA256',
  'SMART_LENDING_EXTERNAL_FEEDS_PROVIDER_APPROVAL_REFERENCE_ID',
  'SMART_LENDING_EXTERNAL_FEEDS_PROVIDER_POLICY_SHA256',
  'SMART_LENDING_EXTERNAL_FEEDS_SOURCE_REVISION',
] as const);
const REVIEWED_VARIABLES = new Set<string>([
  MODE,
  AAVE_V3_KILL_SWITCH,
  DEFILLAMA_KILL_SWITCH,
  LIFI_KILL_SWITCH,
  LIFI_API_KEY,
  ...APPROVAL_VARIABLES,
]);
const MANAGED_PREFIXES = [
  'SMART_LENDING_EXTERNAL_FEEDS_',
  'SMART_LENDING_AAVE_',
  'SMART_LENDING_DEFILLAMA_',
  'SMART_LENDING_LIFI_',
] as const;
const SIGNING_MATERIAL_NAME =
  /(?:^|_)(?:PRIVATE_?KEY|SIGNER(?:_KEY)?|SIGNING_KEY|MNEMONIC|SEED(?:_PHRASE)?|KEYPAIR|SECRET_KEY|WALLET_KEY)(?:_|$)/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IMMUTABLE_SOURCE_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64}|sha256:[0-9a-f]{64})$/u;

function fail(field: string): never {
  throw new SmartLendingExternalFeedConfigurationError(field);
}

function featureVariables(environment: Readonly<NodeJS.ProcessEnv>): readonly string[] {
  return Object.keys(environment).filter((name) => {
    const upper = name.toUpperCase();
    return (
      environment[name] !== undefined && MANAGED_PREFIXES.some((prefix) => upper.startsWith(prefix))
    );
  });
}

function required(environment: Readonly<NodeJS.ProcessEnv>, name: string): string {
  const value = environment[name];
  if (
    value === undefined ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\0\r\n]/u.test(value)
  ) {
    return fail(name);
  }
  return value;
}

function killSwitch(environment: Readonly<NodeJS.ProcessEnv>, name: string): boolean {
  const value = environment[name] ?? 'on';
  if (value !== 'on' && value !== 'off') return fail(name);
  return value === 'on';
}

function optionalApiKey(environment: Readonly<NodeJS.ProcessEnv>): string | null {
  const value = environment[LIFI_API_KEY];
  if (value === undefined) return null;
  if (
    value.length < 8 ||
    value.length > 512 ||
    value.trim() !== value ||
    !/^[\x21-\x7e]+$/u.test(value)
  ) {
    return fail(LIFI_API_KEY);
  }
  return value;
}

function approvalBinding(
  environment: Readonly<NodeJS.ProcessEnv>,
): SmartLendingExternalFeedApprovalBinding | null {
  const configured = APPROVAL_VARIABLES.filter((name) => environment[name] !== undefined);
  if (configured.length === 0) return null;
  if (configured.length !== APPROVAL_VARIABLES.length) {
    return fail('SMART_LENDING_EXTERNAL_FEEDS_APPROVAL_BINDING');
  }

  const egressApprovalReferenceId = required(environment, APPROVAL_VARIABLES[0]);
  const egressPolicySha256 = required(environment, APPROVAL_VARIABLES[1]);
  const providerApprovalReferenceId = required(environment, APPROVAL_VARIABLES[2]);
  const providerPolicySha256 = required(environment, APPROVAL_VARIABLES[3]);
  const sourceRevision = required(environment, APPROVAL_VARIABLES[4]);
  if (!SAFE_REFERENCE.test(egressApprovalReferenceId)) return fail(APPROVAL_VARIABLES[0]);
  if (!SHA256.test(egressPolicySha256)) return fail(APPROVAL_VARIABLES[1]);
  if (!SAFE_REFERENCE.test(providerApprovalReferenceId)) return fail(APPROVAL_VARIABLES[2]);
  if (!SHA256.test(providerPolicySha256)) return fail(APPROVAL_VARIABLES[3]);
  if (!IMMUTABLE_SOURCE_REVISION.test(sourceRevision)) return fail(APPROVAL_VARIABLES[4]);

  return Object.freeze({
    egressApprovalReferenceId,
    egressPolicySha256,
    providerApprovalReferenceId,
    providerPolicySha256,
    sourceRevision,
  });
}

/**
 * Loads only activation state and approval bindings. Endpoint URLs are fixed in
 * the transport and cannot be supplied through the environment.
 */
export function loadSmartLendingExternalFeedConfig(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): SmartLendingExternalFeedConfig {
  const variables = featureVariables(environment);
  const signerVariable = variables.find((name) => SIGNING_MATERIAL_NAME.test(name.toUpperCase()));
  if (signerVariable) return fail(signerVariable.toUpperCase());
  const unknownVariable = variables.find((name) => !REVIEWED_VARIABLES.has(name.toUpperCase()));
  if (unknownVariable) return fail(unknownVariable.toUpperCase());

  const mode = environment[MODE] ?? 'disabled';
  if (mode !== 'disabled' && mode !== 'enabled') return fail(MODE);
  if (mode === 'disabled') {
    const unexpected = variables.find((name) => name.toUpperCase() !== MODE);
    if (unexpected) return fail(unexpected.toUpperCase());
    return Object.freeze({ mode: 'disabled' });
  }

  // The current repository contains only a deny-all egress record. String
  // references and digests are evidence metadata, not proof of a valid,
  // unexpired approval. Keep production activation impossible until a verified
  // activation-manifest capability is implemented and reviewed. Enabled mode
  // also requires an exact standard non-production runtime identity so an
  // absent or misspelled NODE_ENV cannot weaken this boundary.
  if (environment.NODE_ENV === 'production') {
    return fail('SMART_LENDING_EXTERNAL_FEEDS_PRODUCTION_ACTIVATION');
  }
  if (environment.NODE_ENV !== 'development' && environment.NODE_ENV !== 'test') {
    return fail('SMART_LENDING_EXTERNAL_FEEDS_NON_PRODUCTION_ENVIRONMENT');
  }

  const killSwitches = Object.freeze({
    [SmartLendingExternalFeedDestination.AaveV3EthereumMarket]: killSwitch(
      environment,
      AAVE_V3_KILL_SWITCH,
    ),
    [SmartLendingExternalFeedDestination.DefiLlamaYields]: killSwitch(
      environment,
      DEFILLAMA_KILL_SWITCH,
    ),
    [SmartLendingExternalFeedDestination.LifiQuote]: killSwitch(environment, LIFI_KILL_SWITCH),
  });
  const approval = approvalBinding(environment);
  if (Object.values(killSwitches).includes(false) && approval === null) {
    return fail('SMART_LENDING_EXTERNAL_FEEDS_APPROVAL_BINDING');
  }
  return Object.freeze({
    mode: 'enabled',
    killSwitches,
    approval,
    lifiApiKey: optionalApiKey(environment),
  });
}
