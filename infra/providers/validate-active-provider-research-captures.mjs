import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { parseStrictJsonBytes } from '../shared/parse-strict-json.mjs';
import {
  readSecureLocalFile,
  readSecureLocalFileForTest,
} from '../shared/read-secure-local-file.mjs';

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CAPTURE_PATH =
  'docs/provider-research/active-scope-2026-09-04/ethereum-solana-missing-provider-captures.json';
export const SIDECAR_PATH =
  'docs/provider-research/active-scope-2026-09-04/ethereum-solana-missing-provider-captures.sha256';
export const CAPTURE_JSON_INVALID_ERROR =
  'capture must contain strict UTF-8 JSON without a byte-order mark or duplicate object keys';
export const CAPTURE_FILES_INVALID_ERROR = 'capture files are missing, unsafe, or unreadable';

export const MAX_CAPTURE_BYTES = 32_768;
export const MAX_SIDECAR_BYTES = 65;
const EXPECTED_CAPTURE_SHA256 = 'db13db3ff78d6dd0641f8f61067e48d8eb45d0eab309491e2bff9a60112a97d2';
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const CLOSED_FIELD = /^[A-Z][A-Z0-9_]{2,127}$/u;
const PROVIDER_ORDER = ['compound', 'euler', 'gearbox', 'jupiter'];

const ETHEREUM = {
  networkId: 'eip155:1',
  name: 'Ethereum',
  ecosystem: 'EVM',
  environment: 'MAINNET',
};
const SOLANA = {
  networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  name: 'Solana',
  ecosystem: 'SOLANA',
  environment: 'MAINNET',
};
const CLOSED_STATUS = {
  research: 'CATALOGED_OFFLINE_RESEARCH_ONLY',
  integration: 'DORMANT_UNREGISTERED',
  availability: 'UNAVAILABLE',
  approval: 'NOT_APPROVED',
  risk: 'NOT_ASSESSED',
  independentReview: 'NOT_PERFORMED',
  liveEvidence: 'NOT_COLLECTED',
  supportedActions: [],
  mayAuthorizeFinancialAction: false,
};

function source({
  sourceId,
  repositoryUrl,
  commitSha,
  path,
  contentSha256,
  contentByteLength,
  observedFacts,
}) {
  const repositoryPath = new URL(repositoryUrl).pathname.replace(/^\//u, '');
  return {
    sourceId,
    sourceKind: 'OFFICIAL_REPOSITORY_FILE',
    repositoryUrl,
    commitSha,
    path,
    url: `https://raw.githubusercontent.com/${repositoryPath}/${commitSha}/${path}`,
    contentSha256,
    contentByteLength,
    observedFacts,
  };
}

function provider({
  providerId,
  providerName,
  protocolName,
  network,
  officialDocumentationUrls,
  sources,
  identifiers,
  unresolvedFields,
}) {
  return {
    providerId,
    providerName,
    protocolName,
    network,
    status: CLOSED_STATUS,
    officialDocumentationUrls,
    sources,
    identifiers,
    unresolvedFields,
  };
}

const COMPOUND_NETWORK_SOURCE = source({
  sourceId: 'COMPOUND_ETHEREUM_NETWORK_CONFIG',
  repositoryUrl: 'https://github.com/compound-finance/comet',
  commitSha: 'f766f51583c23acc33b2a7824654ef2029a96804',
  path: 'hardhat.config.ts',
  contentSha256: 'd98f061d2200e20e3e9470bf3ae4bbecc31b3f95ec591bb75daf9f8b34d3d742',
  contentByteLength: 18_646,
  observedFacts: [
    'The pinned configuration maps the mainnet network to chainId 1 and includes the mainnet USDC deployment in its scenario bases.',
  ],
});

const COMPOUND_SOURCE = source({
  sourceId: 'COMPOUND_ETHEREUM_USDC_ROOTS',
  repositoryUrl: 'https://github.com/compound-finance/comet',
  commitSha: 'f766f51583c23acc33b2a7824654ef2029a96804',
  path: 'deployments/mainnet/usdc/roots.json',
  contentSha256: '689cf0e940bfdc440eba854201d8ed738be5a442802ee5723a05a4b2d16f6c57',
  contentByteLength: 2003,
  observedFacts: [
    'The pinned Compound Comet deployment path deployments/mainnet/usdc identifies the Comet proxy address recorded below.',
  ],
});

const EULER_SOURCE = source({
  sourceId: 'EULER_ETHEREUM_CHAIN_REGISTRY',
  repositoryUrl: 'https://github.com/euler-xyz/euler-interfaces',
  commitSha: 'd0e9a428523b3de6cb3e6c7a06ad55b6e59223f3',
  path: 'EulerChains.json',
  contentSha256: '20ca447e2f1236210c63e71b616de7a7ef0b33f26c327c89b70ff1d08547b288',
  contentByteLength: 57_718,
  observedFacts: [
    'The pinned registry identifies chainId 1 as ethereum with production status and records the Euler core addresses below.',
  ],
});

const GEARBOX_SOURCE = source({
  sourceId: 'GEARBOX_V3_ETHEREUM_SCOPE',
  repositoryUrl: 'https://github.com/Gearbox-protocol/security',
  commitSha: '3a8af446a2c9f2902b191635ec548e35fdb97dda',
  path: 'bug-bounty/v3-scope.md',
  contentSha256: '17fb638e4ef642a41eda0c5af1aa8bbd15e5b603d382905c0e3cafa4b146cb96',
  contentByteLength: 25_378,
  observedFacts: [
    'The pinned V3 scope identifies its deployed-contract list as Ethereum Mainnet, records version 3_00 for relevant contracts unless otherwise specified, and records the AddressProviderV3 address below.',
    'The pinned scope references Gearbox core-v3 commit e16559ae82f0f24c3dc29693c444f40d676ebff9.',
  ],
});

const JUPITER_OVERVIEW_SOURCE = source({
  sourceId: 'JUPITER_LEND_SOLANA_OVERVIEW',
  repositoryUrl: 'https://github.com/jup-ag/docs',
  commitSha: 'c4b7ee1172ebb1c58407e479e7153bf225690aaf',
  path: 'lend/index.mdx',
  contentSha256: '812e77b08e677348196ac7ac687292b0825c67bfc2ac148fbaa51decb0041a05',
  contentByteLength: 5523,
  observedFacts: [
    'The pinned overview describes Jupiter Lend Earn and Borrow as operating on Solana.',
  ],
});

const JUPITER_ADDRESSES_SOURCE = source({
  sourceId: 'JUPITER_LEND_MAINNET_PROGRAM_ADDRESSES',
  repositoryUrl: 'https://github.com/jup-ag/docs',
  commitSha: 'c4b7ee1172ebb1c58407e479e7153bf225690aaf',
  path: 'lend/program-addresses.mdx',
  contentSha256: 'b1bb2d5285e16512d318d7ca916b3c9e3d2631aac10a1e8af43bc5584c2287d1',
  contentByteLength: 1571,
  observedFacts: [
    'The pinned program-address table marks each of the seven Jupiter Lend program identities recorded below as Mainnet.',
  ],
});

const EXPECTED_PROVIDERS = [
  provider({
    providerId: 'compound',
    providerName: 'Compound',
    protocolName: 'Compound III',
    network: ETHEREUM,
    officialDocumentationUrls: ['https://docs.compound.finance/'],
    sources: [COMPOUND_NETWORK_SOURCE, COMPOUND_SOURCE],
    identifiers: [
      {
        kind: 'EVM_MARKET_PROXY',
        role: 'COMET_USDC_PROXY',
        value: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        sourceId: COMPOUND_SOURCE.sourceId,
      },
    ],
    unresolvedFields: [
      'APPROVED_COMPOUND_MARKET_AND_ASSET_ALLOWLIST',
      'INDEPENDENT_ETHEREUM_DEPLOYMENT_VERIFICATION',
      'FINALIZED_BLOCK_PROXY_IMPLEMENTATION_AND_CODE_HASH_EVIDENCE',
      'READ_ONLY_ADAPTER_AND_TWO_SOURCE_LIVE_EVIDENCE',
      'RISK_LEGAL_SECURITY_EGRESS_AND_OPERATIONS_APPROVALS',
      'TRANSACTION_ACTION_ASSET_AND_WALLET_AUTHORIZATION',
    ],
  }),
  provider({
    providerId: 'euler',
    providerName: 'Euler',
    protocolName: 'Euler V2',
    network: ETHEREUM,
    officialDocumentationUrls: ['https://docs.euler.finance/developers/contract-addresses/'],
    sources: [EULER_SOURCE],
    identifiers: [
      {
        kind: 'EVM_CONTRACT',
        role: 'EVAULT_FACTORY',
        value: '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
        sourceId: EULER_SOURCE.sourceId,
      },
      {
        kind: 'EVM_CONTRACT',
        role: 'ETHEREUM_VAULT_CONNECTOR',
        value: '0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383',
        sourceId: EULER_SOURCE.sourceId,
      },
      {
        kind: 'EVM_CONTRACT',
        role: 'PROTOCOL_CONFIG',
        value: '0x4cD6BF1D183264c02Be7748Cb5cd3A47d013351b',
        sourceId: EULER_SOURCE.sourceId,
      },
    ],
    unresolvedFields: [
      'APPROVED_EULER_VAULT_EARN_MARKET_AND_ASSET_ALLOWLIST',
      'VAULT_GOVERNOR_COLLATERAL_ORACLE_IRM_CAP_AND_LIQUIDITY_RISK_ASSESSMENT',
      'FINALIZED_BLOCK_FACTORY_DEPLOYMENT_AND_CODE_HASH_EVIDENCE',
      'READ_ONLY_ADAPTER_AND_TWO_SOURCE_LIVE_EVIDENCE',
      'RISK_LEGAL_SECURITY_EGRESS_AND_OPERATIONS_APPROVALS',
      'TRANSACTION_ACTION_ASSET_AND_WALLET_AUTHORIZATION',
    ],
  }),
  provider({
    providerId: 'gearbox',
    providerName: 'Gearbox',
    protocolName: 'Gearbox V3',
    network: ETHEREUM,
    officialDocumentationUrls: ['https://docs.gearbox.finance/developers/sdk-setup'],
    sources: [GEARBOX_SOURCE],
    identifiers: [
      {
        kind: 'EVM_CONTRACT',
        role: 'ADDRESS_PROVIDER_V3',
        value: '0x9ea7b04Da02a5373317D745c1571c84aaD03321D',
        sourceId: GEARBOX_SOURCE.sourceId,
      },
    ],
    unresolvedFields: [
      'APPROVED_GEARBOX_POOL_MARKET_AND_ASSET_ALLOWLIST',
      'ADDRESS_PROVIDER_DISCOVERY_AND_COMPONENT_IDENTITY_EVIDENCE',
      'POOL_CREDIT_MANAGER_ORACLE_CAP_AND_LIQUIDITY_RISK_ASSESSMENT',
      'FINALIZED_BLOCK_IMPLEMENTATION_AND_CODE_HASH_EVIDENCE',
      'READ_ONLY_ADAPTER_AND_TWO_SOURCE_LIVE_EVIDENCE',
      'RISK_LEGAL_SECURITY_EGRESS_OPERATIONS_AND_TRANSACTION_APPROVALS',
    ],
  }),
  provider({
    providerId: 'jupiter',
    providerName: 'Jupiter',
    protocolName: 'Jupiter Lend',
    network: SOLANA,
    officialDocumentationUrls: [
      'https://developers.jup.ag/docs/lend',
      'https://developers.jup.ag/docs/lend/program-addresses',
    ],
    sources: [JUPITER_OVERVIEW_SOURCE, JUPITER_ADDRESSES_SOURCE],
    identifiers: [
      {
        kind: 'SOLANA_PROGRAM',
        role: 'EARN',
        value: 'jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9',
        sourceId: JUPITER_ADDRESSES_SOURCE.sourceId,
      },
      {
        kind: 'SOLANA_PROGRAM',
        role: 'LIQUIDITY',
        value: 'jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC',
        sourceId: JUPITER_ADDRESSES_SOURCE.sourceId,
      },
      {
        kind: 'SOLANA_PROGRAM',
        role: 'LENDING_REWARDS_RATE_MODEL',
        value: 'jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar',
        sourceId: JUPITER_ADDRESSES_SOURCE.sourceId,
      },
      {
        kind: 'SOLANA_PROGRAM',
        role: 'ORACLE',
        value: 'jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc',
        sourceId: JUPITER_ADDRESSES_SOURCE.sourceId,
      },
      {
        kind: 'SOLANA_PROGRAM',
        role: 'VAULTS_BORROW',
        value: 'jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi',
        sourceId: JUPITER_ADDRESSES_SOURCE.sourceId,
      },
      {
        kind: 'SOLANA_PROGRAM',
        role: 'FLASHLOAN',
        value: 'jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS',
        sourceId: JUPITER_ADDRESSES_SOURCE.sourceId,
      },
      {
        kind: 'SOLANA_PROGRAM',
        role: 'LEND_AMM',
        value: 'jupZ4m2GqUCJ5iueMfzQf8khFfH31d4XAQt3RzCT9Vd',
        sourceId: JUPITER_ADDRESSES_SOURCE.sourceId,
      },
    ],
    unresolvedFields: [
      'APPROVED_JUPITER_EARN_VAULT_BORROW_MARKET_AND_ASSET_ALLOWLIST',
      'PROGRAM_DATA_UPGRADE_AUTHORITY_BINARY_HASH_AND_DEPLOYMENT_SLOT_EVIDENCE',
      'IDL_VERSION_ACCOUNT_DECODER_AND_SDK_DEPENDENCY_PIN',
      'FINALIZED_COMMITMENT_READ_PLAN_AND_TWO_SOURCE_LIVE_EVIDENCE',
      'PROGRAM_ORACLE_MARKET_CAP_AND_LIQUIDITY_RISK_ASSESSMENT',
      'RISK_LEGAL_SECURITY_EGRESS_OPERATIONS_AND_TRANSACTION_APPROVALS',
    ],
  }),
];

const EXPECTED_RECORD = {
  schemaVersion: 1,
  artifactId: 'ACTIVE_SCOPE_PROVIDER_RESEARCH_CAPTURE_V1',
  capturedOn: '2026-09-04',
  capturedAt: '2026-09-04T15:39:48.567Z',
  captureMethod: 'OFFICIAL_STATIC_DOCUMENTATION_AND_REPOSITORIES_ONLY',
  scope: {
    releaseNetworks: [ETHEREUM, SOLANA],
    providerIds: PROVIDER_ORDER,
    researchOnly: true,
    mayAuthorizeFinancialAction: false,
    runtimeRegistration: 'ABSENT',
    liveEvidenceStatus: 'NOT_COLLECTED',
  },
  providers: EXPECTED_PROVIDERS,
  programWideUnresolvedFields: [
    'APPROVED_PRIMARY_AND_INDEPENDENT_RPC_ENDPOINT_IDENTITIES',
    'PROVIDER_SPECIFIC_READ_ONLY_ADAPTERS_AND_COMPLETENESS_PROOFS',
    'FINALIZED_CHAIN_IDENTITY_FRESHNESS_DIVERGENCE_REORG_AND_OUTAGE_EVIDENCE',
    'PRODUCTION_OBSERVABILITY_ALERTING_INCIDENT_RESPONSE_AND_ROLLBACK_EVIDENCE',
    'LEGAL_REGULATORY_PRIVACY_SECURITY_DEPENDENCY_FINANCE_AND_OPERATIONS_APPROVALS',
    'SEPARATE_MAINNET_WRITE_ALLOWLIST_SIMULATION_POLICY_AND_USER_AUTHORIZATION',
  ],
  zeroCostEvidence: {
    method: 'OFFICIAL_DOCUMENTATION_AND_REPOSITORY_READS_LOCAL_FILE_AUTHORING',
    officialSourceHttpsReadsPerformed: true,
    providerAccountsCreated: 0,
    providerApiRequestsSent: 0,
    rpcRequestsSent: 0,
    webSocketConnectionsOpened: 0,
    providerCredentialsUsed: 0,
    egressPoliciesChanged: 0,
    runtimeRegistrationsAdded: 0,
    transactionsSubmitted: 0,
    paidServicesActivated: 0,
    costIncurredUsd: '0.00',
  },
};

const DOCUMENTATION_URLS = new Set(
  EXPECTED_PROVIDERS.flatMap(({ officialDocumentationUrls }) => officialDocumentationUrls),
);
const REPOSITORY_URLS = new Set([
  'https://github.com/compound-finance/comet',
  'https://github.com/euler-xyz/euler-interfaces',
  'https://github.com/Gearbox-protocol/security',
  'https://github.com/jup-ag/docs',
]);

function plainRecord(value, label, errors) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${label} must be a plain object`);
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    errors.push(`${label} must use a data-only object prototype`);
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== 'string' ||
        !('value' in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    errors.push(`${label} must contain enumerable data properties only`);
    return null;
  }
  return value;
}

function dataArray(value, label, maximumLength, errors) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    errors.push(`${label} must be a data-only array`);
    return [];
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumLength ||
    lengthDescriptor.enumerable !== false
  ) {
    errors.push(`${label} must be dense, bounded, and free of extra properties`);
    return [];
  }
  const expectedKeys = [...Array.from({ length }, (_, index) => String(index)), 'length'];
  if (
    Reflect.ownKeys(descriptors).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
    expectedKeys.slice(0, -1).some((key) => {
      const descriptor = descriptors[key];
      return !('value' in descriptor) || descriptor.enumerable !== true;
    })
  ) {
    errors.push(`${label} must be dense, bounded, and free of extra properties`);
    return [];
  }
  return value;
}

function secureHttpsUrl(value, allowlist, label, errors) {
  if (typeof value !== 'string' || value.length > 512) {
    errors.push(`${label} must be a bounded URL`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      parsed.search !== '' ||
      parsed.hash !== '' ||
      !allowlist.has(value)
    ) {
      errors.push(`${label} is not an exact approved official HTTPS URL`);
    }
  } catch {
    errors.push(`${label} is not a valid URL`);
  }
}

function validateSource(value, providerIndex, sourceIndex, sourceIds, errors) {
  const label = `providers[${providerIndex}].sources[${sourceIndex}]`;
  const record = plainRecord(value, label, errors);
  if (!record) return;
  if (typeof record.sourceId === 'string') {
    if (sourceIds.has(record.sourceId)) errors.push(`${label}.sourceId must be unique`);
    sourceIds.add(record.sourceId);
  }
  secureHttpsUrl(record.repositoryUrl, REPOSITORY_URLS, `${label}.repositoryUrl`, errors);
  if (typeof record.commitSha !== 'string' || !COMMIT_SHA.test(record.commitSha)) {
    errors.push(`${label}.commitSha must be a full lowercase commit SHA`);
  }
  if (
    typeof record.path !== 'string' ||
    record.path.length === 0 ||
    record.path.length > 160 ||
    record.path.startsWith('/') ||
    record.path.includes('\\') ||
    record.path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    errors.push(`${label}.path must be a bounded repository-relative path`);
  }
  if (typeof record.repositoryUrl === 'string' && typeof record.commitSha === 'string') {
    try {
      const repositoryPath = new URL(record.repositoryUrl).pathname.replace(/^\//u, '');
      const expectedRawUrl = `https://raw.githubusercontent.com/${repositoryPath}/${record.commitSha}/${record.path}`;
      secureHttpsUrl(record.url, new Set([expectedRawUrl]), `${label}.url`, errors);
    } catch {
      errors.push(`${label}.url could not be bound to its repository and commit`);
    }
  }
  if (typeof record.contentSha256 !== 'string' || !SHA256.test(record.contentSha256)) {
    errors.push(`${label}.contentSha256 must be lowercase SHA-256`);
  }
  if (
    !Number.isSafeInteger(record.contentByteLength) ||
    record.contentByteLength < 1 ||
    record.contentByteLength > 65_536
  ) {
    errors.push(`${label}.contentByteLength must be within the bounded source limit`);
  }
  const facts = dataArray(record.observedFacts, `${label}.observedFacts`, 4, errors);
  if (
    facts.length === 0 ||
    facts.some((fact) => typeof fact !== 'string' || fact.length < 20 || fact.length > 300)
  ) {
    errors.push(`${label}.observedFacts must be bounded non-empty strings`);
  }
}

function validateProvider(value, index, errors) {
  const label = `providers[${index}]`;
  const record = plainRecord(value, label, errors);
  if (!record) return;
  const expectedId = PROVIDER_ORDER[index];
  if (record.providerId !== expectedId)
    errors.push(`${label}.providerId is outside the closed order`);

  const expectedNetwork = index === 3 ? SOLANA : ETHEREUM;
  if (!isDeepStrictEqual(record.network, expectedNetwork)) {
    errors.push(`${label}.network must be its exact active-scope mainnet`);
  }
  if (!isDeepStrictEqual(record.status, CLOSED_STATUS)) {
    errors.push(`${label}.status must remain unavailable, dormant, and unapproved`);
  }

  const documentationUrls = dataArray(
    record.officialDocumentationUrls,
    `${label}.officialDocumentationUrls`,
    3,
    errors,
  );
  documentationUrls.forEach((url, urlIndex) =>
    secureHttpsUrl(
      url,
      DOCUMENTATION_URLS,
      `${label}.officialDocumentationUrls[${urlIndex}]`,
      errors,
    ),
  );

  const sourceIds = new Set();
  dataArray(record.sources, `${label}.sources`, 3, errors).forEach((entry, sourceIndex) =>
    validateSource(entry, index, sourceIndex, sourceIds, errors),
  );

  const identifiers = dataArray(record.identifiers, `${label}.identifiers`, 8, errors);
  const identifierValues = new Set();
  for (const [identifierIndex, entry] of identifiers.entries()) {
    const identifierLabel = `${label}.identifiers[${identifierIndex}]`;
    const identifier = plainRecord(entry, identifierLabel, errors);
    if (!identifier) continue;
    if (typeof identifier.value !== 'string' || identifierValues.has(identifier.value)) {
      errors.push(`${identifierLabel}.value must be a unique string`);
    } else {
      identifierValues.add(identifier.value);
    }
    if (
      (identifier.kind === 'EVM_CONTRACT' || identifier.kind === 'EVM_MARKET_PROXY') &&
      (record.network?.ecosystem !== 'EVM' || !EVM_ADDRESS.test(identifier.value))
    ) {
      errors.push(`${identifierLabel} must be an EVM address on Ethereum`);
    }
    if (
      identifier.kind === 'SOLANA_PROGRAM' &&
      (record.network?.ecosystem !== 'SOLANA' || !SOLANA_ADDRESS.test(identifier.value))
    ) {
      errors.push(`${identifierLabel} must be a base58 Solana program address`);
    }
    if (!sourceIds.has(identifier.sourceId)) {
      errors.push(`${identifierLabel}.sourceId must resolve within the provider capture`);
    }
  }

  const unresolved = dataArray(record.unresolvedFields, `${label}.unresolvedFields`, 12, errors);
  if (
    unresolved.length === 0 ||
    new Set(unresolved).size !== unresolved.length ||
    unresolved.some((field) => typeof field !== 'string' || !CLOSED_FIELD.test(field))
  ) {
    errors.push(`${label}.unresolvedFields must be a unique closed list`);
  }
}

export function validateProviderResearchCaptureRecord(value) {
  const errors = [];
  try {
    const record = plainRecord(value, 'capture', errors);
    if (!record) return errors;
    const providers = dataArray(record.providers, 'providers', 4, errors);
    if (providers.length !== 4) errors.push('providers must contain exactly four captures');
    providers.forEach((entry, index) => validateProvider(entry, index, errors));

    const programWide = dataArray(
      record.programWideUnresolvedFields,
      'programWideUnresolvedFields',
      12,
      errors,
    );
    if (
      programWide.length === 0 ||
      new Set(programWide).size !== programWide.length ||
      programWide.some((field) => typeof field !== 'string' || !CLOSED_FIELD.test(field))
    ) {
      errors.push('programWideUnresolvedFields must be a unique closed list');
    }

    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch {
      errors.push('capture must be JSON-serializable');
    }
    if (/\b(?:base|bnb|bsc|testnet|devnet|sepolia)\b|eip155:(?:56|8453|84532)/iu.test(serialized)) {
      errors.push('capture must not contain Base, BNB Smart Chain, or testnet scope');
    }
    if (!isDeepStrictEqual(value, EXPECTED_RECORD)) {
      errors.push('capture does not match the closed reviewed artifact');
    }
  } catch {
    errors.push('capture validation failed closed');
  }
  return [...new Set(errors)];
}

export function validateProviderResearchCaptureSidecar(captureBytes, sidecarText) {
  const errors = [];
  try {
    if (!Buffer.isBuffer(captureBytes) || captureBytes.length === 0) {
      errors.push('capture bytes are required');
      return errors;
    }
    if (typeof sidecarText !== 'string' || !/^[0-9a-f]{64}\n$/u.test(sidecarText)) {
      errors.push('sidecar must be one lowercase SHA-256 followed by LF');
      return errors;
    }
    const expected = createHash('sha256').update(captureBytes).digest('hex');
    if (sidecarText !== `${expected}\n`) errors.push('sidecar does not match the capture bytes');
  } catch {
    errors.push('sidecar validation failed closed');
  }
  return errors;
}

export function parseProviderResearchCaptureBytes(captureBytes) {
  try {
    return parseStrictJsonBytes(captureBytes);
  } catch {
    throw new Error(CAPTURE_JSON_INVALID_ERROR);
  }
}

function repositoryFile(repositoryRoot, relativePath, maximumBytes, afterFirstReadForTest) {
  try {
    const root = realpathSync.native(resolve(repositoryRoot));
    const resolved = resolve(root, relativePath);
    const pathRelativeToRoot = relative(root, resolved);
    if (
      pathRelativeToRoot === '' ||
      pathRelativeToRoot === '..' ||
      pathRelativeToRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathRelativeToRoot)
    ) {
      throw new Error(CAPTURE_FILES_INVALID_ERROR);
    }
    return afterFirstReadForTest === undefined
      ? readSecureLocalFile(resolved, maximumBytes)
      : readSecureLocalFileForTest(resolved, maximumBytes, () =>
          afterFirstReadForTest(relativePath),
        );
  } catch {
    throw new Error(CAPTURE_FILES_INVALID_ERROR);
  }
}

function validateProviderResearchCaptureFilesInternal(repositoryRoot, afterFirstReadForTest) {
  const errors = [];
  let fingerprint = null;
  try {
    const captureBytes = repositoryFile(
      repositoryRoot,
      CAPTURE_PATH,
      MAX_CAPTURE_BYTES,
      afterFirstReadForTest,
    );
    const sidecarBytes = repositoryFile(
      repositoryRoot,
      SIDECAR_PATH,
      MAX_SIDECAR_BYTES,
      afterFirstReadForTest,
    );
    const captureText = new TextDecoder('utf-8', { fatal: true }).decode(captureBytes);
    const sidecarText = new TextDecoder('utf-8', { fatal: true }).decode(sidecarBytes);
    if (
      captureText.startsWith('\uFEFF') ||
      captureText.includes('\r') ||
      !captureText.endsWith('\n') ||
      captureText.endsWith('\n\n') ||
      captureText.split('\n').some((line) => /[\t ]+$/u.test(line))
    ) {
      errors.push('capture bytes must be canonical UTF-8 with LF and no trailing whitespace');
    }
    let record;
    try {
      record = parseProviderResearchCaptureBytes(captureBytes);
    } catch {
      errors.push(CAPTURE_JSON_INVALID_ERROR);
    }
    if (record !== undefined) errors.push(...validateProviderResearchCaptureRecord(record));
    errors.push(...validateProviderResearchCaptureSidecar(captureBytes, sidecarText));
    fingerprint = createHash('sha256').update(captureBytes).digest('hex');
    if (fingerprint !== EXPECTED_CAPTURE_SHA256) {
      errors.push('capture bytes do not match the reviewed canonical artifact');
    }
  } catch {
    errors.push(CAPTURE_FILES_INVALID_ERROR);
  }
  return { errors: [...new Set(errors)], fingerprint };
}

export function validateProviderResearchCaptureFiles(repositoryRoot = REPOSITORY_ROOT) {
  return validateProviderResearchCaptureFilesInternal(repositoryRoot, undefined);
}

/** Test-only fault seam for mutations between the two stable descriptor reads. */
export function validateProviderResearchCaptureFilesForTest(repositoryRoot, afterFirstReadForTest) {
  return validateProviderResearchCaptureFilesInternal(repositoryRoot, afterFirstReadForTest);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const result = validateProviderResearchCaptureFiles();
  if (result.errors.length === 0) {
    console.log(`Active-scope provider research capture is valid: ${result.fingerprint}`);
  } else {
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  }
}
