import { bindExecutableWorkload } from '../../infrastructure/config/application-workload';
import {
  loadBalanceConsumerInfrastructureConfig,
  type BalanceConsumerInfrastructureConfig,
} from '../../infrastructure/config/infrastructure.config';
import {
  loadBalanceConsumerConfig,
  type EnabledBalanceConsumerConfig,
} from '../infrastructure/config/balance-consumer.config';
import { BALANCE_CONSUMER_SOURCE_ACTIVATION } from './balance-sync-consumer.activation';

export const BALANCE_CONSUMER_SOURCE_APPROVAL = 'ethereum-solana-mainnet-reviewed' as const;
export const BALANCE_CONSUMER_NETWORK_SCOPE = 'ethereum-solana-mainnet' as const;

export type BalanceConsumerStartupBlocker =
  | 'ARGUMENTS_INVALID'
  | 'BALANCE_CONFIGURATION_INVALID'
  | 'BALANCE_CONFIGURATION_NOT_ENABLED'
  | 'ENVIRONMENT_SHAPE_INVALID'
  | 'FORBIDDEN_ENVIRONMENT'
  | 'INFRASTRUCTURE_CONFIGURATION_INVALID'
  | 'NETWORK_SCOPE_INVALID'
  | 'NON_PRODUCTION_RUNTIME'
  | 'RUNTIME_START_FAILED'
  | 'SOURCE_ACTIVATION_DISABLED'
  | 'SOURCE_APPROVAL_INVALID'
  | 'WORKLOAD_IDENTITY_INVALID';

export interface BalanceConsumerCliEvaluation {
  readonly status: 'ready' | 'refused';
  readonly exitCode: 0 | 1;
  readonly blockers: readonly BalanceConsumerStartupBlocker[];
}

interface BalanceConsumerLaunchContext {
  readonly balance: EnabledBalanceConsumerConfig;
  readonly infrastructure: BalanceConsumerInfrastructureConfig;
}

interface InternalEvaluation {
  readonly publicResult: BalanceConsumerCliEvaluation;
  readonly launchContext?: BalanceConsumerLaunchContext;
}

export interface BalanceConsumerRuntimeModule {
  readonly startBalanceSyncConsumerRuntime: (
    context: BalanceConsumerLaunchContext,
  ) => Promise<void>;
}

export type BalanceConsumerRuntimeLoader = () => Promise<BalanceConsumerRuntimeModule>;

const BALANCE_CONSUMER_ENVIRONMENT = new Set([
  'BALANCE_CONSUMER_MODE',
  'BALANCE_CONSUMER_NETWORK',
  'BALANCE_CONSUMER_SOURCE_APPROVAL',
  'BALANCE_CONSUMER_WALLET_METADATA_KEY_RING_JSON',
]);

const FORBIDDEN_EXACT_ENVIRONMENT = new Set([
  'API_KEY',
  'ACCESS_TOKEN',
  'BEARER_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
  'AWS_ROLE_ARN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'AWS_ENDPOINT_URL',
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'DATABASE_URL',
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USERNAME',
  'DATABASE_PASSWORD',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGPASSFILE',
  'PGSSLMODE',
  'PGSSLROOTCERT',
  'PGOPTIONS',
  'CHAIN_ID',
]);

const FORBIDDEN_ENVIRONMENT_PATTERNS = [
  /^(?:ETHEREUM|SOLANA|EVM|BLOCKCHAIN|ALCHEMY|INFURA|QUICKNODE|HELIUS|ANKR|CHAINSTACK|TRITON)(?:_|$)/u,
  /(?:^|_)(?:RPC|PROVIDER)(?:_|$)/u,
  /(?:^|_)(?:AUTH|AUTHORIZATION|OIDC|COGNITO|JWT|SESSION|COOKIE|NEXTAUTH)(?:_|$)/u,
  /(?:^|_)WALLET(?:_|$)/u,
  /^(?:AUTH0|OKTA|CLERK|PRIVY|MAGIC|FIREBASE|SUPABASE|WALLETCONNECT|METAMASK|PHANTOM)(?:_|$)/u,
  /^(?:ORACLE|PRICE_FEED|PRICE_PROVIDER|MORALIS|DRPC|GETBLOCK|VIEM|WEB3)(?:_|$)/u,
  /^REDIS(?:_|$)/u,
  /(?:^|_)(?:SIGNING|SIGNER|PRIVATE_KEY|MNEMONIC|SEED_PHRASE|SECRET_KEY)(?:_|$)/u,
  /(?:^|_)(?:ADMIN|MASTER)(?:_|$)/u,
  /(?:^|_)(?:LEGACY|DEMO|TESTNET|BASE)(?:_|$)/u,
  /^MIGRATION_DATABASE_/u,
] as const;

function refused(blockers: readonly BalanceConsumerStartupBlocker[]): BalanceConsumerCliEvaluation {
  return Object.freeze({
    status: 'refused',
    exitCode: 1,
    blockers: Object.freeze([...blockers]),
  });
}

function ready(): BalanceConsumerCliEvaluation {
  return Object.freeze({ status: 'ready', exitCode: 0, blockers: Object.freeze([]) });
}

function snapshotEnvironment(environment: Readonly<NodeJS.ProcessEnv>): {
  readonly environment?: NodeJS.ProcessEnv;
  readonly valid: boolean;
} {
  try {
    if (Object.getOwnPropertySymbols(environment).length > 0) return { valid: false };
    const descriptors = Object.getOwnPropertyDescriptors(environment);
    const snapshot = Object.create(null) as NodeJS.ProcessEnv;
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor)) return { valid: false };
      const value = descriptor.value as unknown;
      if (value === undefined) continue;
      if (typeof value !== 'string') return { valid: false };
      snapshot[name] = value;
    }
    return { valid: true, environment: snapshot };
  } catch {
    return { valid: false };
  }
}

function hasForbiddenEnvironment(environment: Readonly<NodeJS.ProcessEnv>): boolean {
  return Object.keys(environment).some((name) => {
    if (BALANCE_CONSUMER_ENVIRONMENT.has(name)) return false;
    const canonicalName = name.toUpperCase();
    if (canonicalName.startsWith('BALANCE_CONSUMER_')) return true;
    if (FORBIDDEN_EXACT_ENVIRONMENT.has(canonicalName)) return true;
    return FORBIDDEN_ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(canonicalName));
  });
}

function evaluateInternal(
  argv: readonly string[],
  inputEnvironment: Readonly<NodeJS.ProcessEnv>,
): InternalEvaluation {
  const blockers: BalanceConsumerStartupBlocker[] = [];
  if (!BALANCE_CONSUMER_SOURCE_ACTIVATION.enabled) {
    blockers.push('SOURCE_ACTIVATION_DISABLED');
  }
  if (argv.length !== 0) blockers.push('ARGUMENTS_INVALID');

  const snapshot = snapshotEnvironment(inputEnvironment);
  if (!snapshot.valid || !snapshot.environment) {
    blockers.push('ENVIRONMENT_SHAPE_INVALID');
    return { publicResult: refused(blockers) };
  }
  const environment = snapshot.environment;
  const forbiddenEnvironment = hasForbiddenEnvironment(environment);
  if (forbiddenEnvironment) blockers.push('FORBIDDEN_ENVIRONMENT');
  if (environment.NODE_ENV !== 'production') blockers.push('NON_PRODUCTION_RUNTIME');
  if (environment.APPLICATION_WORKLOAD !== 'balance-consumer') {
    blockers.push('WORKLOAD_IDENTITY_INVALID');
  }
  if (environment.BALANCE_CONSUMER_SOURCE_APPROVAL !== BALANCE_CONSUMER_SOURCE_APPROVAL) {
    blockers.push('SOURCE_APPROVAL_INVALID');
  }
  if (environment.BALANCE_CONSUMER_NETWORK !== BALANCE_CONSUMER_NETWORK_SCOPE) {
    blockers.push('NETWORK_SCOPE_INVALID');
  }

  let balance: EnabledBalanceConsumerConfig | undefined;
  try {
    const configured = loadBalanceConsumerConfig(environment);
    if (configured.mode === 'enabled') balance = configured;
    else blockers.push('BALANCE_CONFIGURATION_NOT_ENABLED');
  } catch {
    blockers.push('BALANCE_CONFIGURATION_INVALID');
  }

  let infrastructure: BalanceConsumerInfrastructureConfig | undefined;
  if (!forbiddenEnvironment && environment.NODE_ENV === 'production') {
    try {
      bindExecutableWorkload(environment, 'balance-consumer');
      infrastructure = loadBalanceConsumerInfrastructureConfig(environment);
    } catch {
      blockers.push('INFRASTRUCTURE_CONFIGURATION_INVALID');
    }
  }

  if (blockers.length > 0 || !balance || !infrastructure) {
    return { publicResult: refused(blockers) };
  }
  return {
    publicResult: ready(),
    launchContext: Object.freeze({ balance, infrastructure }),
  };
}

export function evaluateBalanceSyncConsumerCliMode(
  argv: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
): BalanceConsumerCliEvaluation {
  return evaluateInternal(argv, environment).publicResult;
}

async function loadRuntime(): Promise<BalanceConsumerRuntimeModule> {
  return import('./balance-sync-consumer.runtime');
}

export async function runBalanceSyncConsumerCli(
  argv: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  runtimeLoader: BalanceConsumerRuntimeLoader = loadRuntime,
): Promise<BalanceConsumerCliEvaluation> {
  const evaluation = evaluateInternal(argv, environment);
  if (!evaluation.launchContext) return evaluation.publicResult;
  try {
    const runtime = await runtimeLoader();
    await runtime.startBalanceSyncConsumerRuntime(evaluation.launchContext);
    return evaluation.publicResult;
  } catch {
    return refused(['RUNTIME_START_FAILED']);
  }
}
