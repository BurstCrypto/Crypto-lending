import { Buffer } from 'node:buffer';

import { parseAccountId } from '../../accounts/domain/account-profile';
import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import type { PostgresService } from '../../infrastructure/database/postgres.service';
import {
  DormantProviderPositionChainAnchorEvidenceProducer,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
  fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
  type ProduceProviderPositionChainAnchorEvidenceRequestV1,
  type ProviderPositionChainAnchorEvidenceSourceBindingV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1,
  type ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
} from '../../mainnet-platforms/application/dormant-provider-position-chain-anchor-evidence.producer';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
  type RecordProviderPositionChainAnchorEvidenceRequestV2,
} from '../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-recorder.port';
import {
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
  PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
  type ProviderPositionChainAnchorEvidenceSourcePort,
  type ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
} from '../../mainnet-platforms/application/ports/provider-position-chain-anchor-evidence-source.port';
import { PostgresProviderPositionChainAnchorEvidenceRecorder } from '../../mainnet-platforms/infrastructure/postgres-provider-position-chain-anchor-evidence.recorder';
import type {
  ActiveWalletRegistrationRecord,
  WalletRegistrationRepositoryPort,
} from '../../wallets/application/ports/wallet-registration-repository.port';
import { WalletRegistrationService } from '../../wallets/application/wallet-registration.service';
import { parseWalletChallengeId } from '../../wallets/domain/wallet-ownership-proof';
import { loadWalletRegistrationConfig } from '../../wallets/infrastructure/config/wallet-registration.config';
import {
  activeWalletRegistrationKey,
  digestWalletIdentity,
  sealWalletRegistrationValue,
} from '../../wallets/infrastructure/crypto/wallet-registration-crypto';
import {
  DormantMainnetFinancialActionFinalityEvidenceProducer,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE,
  type MainnetFinancialActionFinalityEvidenceSourceBindingV1,
  type ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1,
} from '../application/dormant-mainnet-financial-action-finality-evidence.producer';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
  DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
  type ReadDormantMainnetFinancialActionDurableRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-lifecycle-durable.port';
import type {
  ReadMainnetFinancialActionEffectiveSafetyStateRequestV1,
  RecordMainnetFinancialActionPostFinalityReviewRequestV1,
} from '../application/ports/dormant-mainnet-financial-action-finality-sidecar-durable.port';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
  MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION,
  type MainnetFinancialActionFinalityEvidenceSourcePort,
  type MainnetFinancialActionPostFinalityEvidenceSourceAttestationV1,
  type ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
} from '../application/ports/mainnet-financial-action-finality-evidence-source.port';
import {
  MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION,
  MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE,
  type IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1,
} from '../application/ports/mainnet-financial-action-finality-prerequisite-issuer.port';
import { PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter } from './postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter';
import type { MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS } from './postgres-dormant-mainnet-financial-action-finality-prerequisite.adapter';
import {
  DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
  PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter,
} from './postgres-dormant-mainnet-financial-action-finality-sidecar.adapter';
import { PostgresDormantMainnetFinancialActionLifecycleDurableAdapter } from './postgres-dormant-mainnet-financial-action-lifecycle-durable.adapter';
import { WalletRegistrationMainnetFinancialActionFinalityWalletReader } from './wallet-registration-mainnet-financial-action-finality-wallet.reader';

const ETHEREUM = 'eip155:1' as const;
const SOLANA = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' as const;
type Network = typeof ETHEREUM | typeof SOLANA;

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const INTENT_ID = '22222222-2222-4222-8222-222222222222';
const WALLET_ID = '33333333-3333-4333-8333-333333333333';
const REPLAY_ID = '44444444-4444-4444-8444-444444444444';
const YIELD_OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const YIELD_SUBMISSION_ID = '66666666-6666-4666-8666-666666666666';
const LEDGER_TRANSACTION_ID = '77777777-7777-4777-8777-777777777777';
const LEDGER_BOOK_ID = '88888888-8888-4888-8888-888888888888';
const OBSERVATION_ID = '99999999-9999-4999-8999-999999999999';
const REVIEW_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORRELATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_AUTHORITY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEPLOYMENT_AUTHORITY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CHALLENGE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const OBSERVED_AT = '2026-09-07T11:59:59.000Z';
const NOW = '2026-09-07T12:00:00.000Z';
const DEADLINE = '2026-09-07T12:00:20.000Z';
const AUTHORITY_EXPIRY = '2026-09-07T12:00:15.000Z';
const SOURCE_PAIR_EXPIRY = '2026-09-07T12:01:00.000Z';
const REGISTERED_AT = '2026-09-01T12:00:00.000Z';

const INTENT_FINGERPRINT = '1'.repeat(64);
const VOLATILE_COMMITMENT = '2'.repeat(64);
const TERMINAL_SNAPSHOT = '3'.repeat(64);
const SUBMISSION_FINGERPRINT = '4'.repeat(64);
const WALLET_PAYLOAD = '5'.repeat(64);
const WALLET_SIGNATURE = '6'.repeat(64);
const CHAIN_EVIDENCE_FINGERPRINT = '7'.repeat(64);
const RECORD_INTENT_FINGERPRINT = '8'.repeat(64);
const READ_BINDING_FINGERPRINT = '9'.repeat(64);
const DEADLINE_BINDING_FINGERPRINT = 'a'.repeat(64);
const TERMINAL_TRANSITION_FINGERPRINT = 'b'.repeat(64);
const ORIGINAL_ADMISSION_FINGERPRINT = 'c'.repeat(64);
const SOURCE_AUTHORITY_FINGERPRINT = 'd'.repeat(64);
const DEPLOYMENT_AUTHORITY_FINGERPRINT = 'e'.repeat(64);
const IDEMPOTENCY_DIGEST = 'f'.repeat(64);
const PRIMARY_DEPLOYMENT_MANIFEST = '12'.repeat(32);
const PRIMARY_OBSERVED_IDENTITY = '23'.repeat(32);
const CORROBORATING_DEPLOYMENT_MANIFEST = '34'.repeat(32);
const CORROBORATING_OBSERVED_IDENTITY = '45'.repeat(32);
const TRANSACTION_BLOCK_IDENTITY = '56'.repeat(32);
const FINALIZED_BLOCK_IDENTITY = '67'.repeat(32);

const EVM_TRANSACTION = `0x${'1'.repeat(64)}`;
const EVM_BLOCK = `0x${'2'.repeat(64)}`;
const EVM_FINALIZED_BLOCK = `0x${'3'.repeat(64)}`;
const EVM_CURRENT_BLOCK = `0x${'4'.repeat(64)}`;
const EVM_WALLET = '0x1111111111111111111111111111111111111111';
const EVM_MARKET = '0x2222222222222222222222222222222222222222';

function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function nullRecord<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function base58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let output = '';
  while (value > 0n) {
    output = alphabet[Number(value % 58n)] + output;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output;
}

const SOLANA_TRANSACTION = base58(new Uint8Array(64).fill(7));
const SOLANA_BLOCK = base58(new Uint8Array(32).fill(8));
const SOLANA_FINALIZED_BLOCK = base58(new Uint8Array(32).fill(9));
const SOLANA_WALLET = base58(new Uint8Array(32).fill(10));
const SOLANA_MARKET = base58(new Uint8Array(32).fill(11));

interface Scenario {
  readonly networkId: Network;
  readonly transactionId: string;
  readonly transactionBlockId: string;
  readonly finalizedBlockId: string;
  readonly walletAddress: string;
  readonly providerId: 'aave' | 'kamino';
  readonly protocolId: 'aave-v3' | 'kamino-lend';
  readonly marketId: string;
  readonly chainAnchor: ProduceProviderPositionChainAnchorEvidenceRequestV1['chainAnchor'];
  readonly currentHead: ProduceProviderPositionChainAnchorEvidenceRequestV1['chainAnchor'];
  readonly finalizedHead: ProduceProviderPositionChainAnchorEvidenceRequestV1['chainAnchor'];
}

function scenario(networkId: Network): Scenario {
  return networkId === ETHEREUM
    ? frozen({
        networkId,
        transactionId: EVM_TRANSACTION,
        transactionBlockId: EVM_BLOCK,
        finalizedBlockId: EVM_FINALIZED_BLOCK,
        walletAddress: EVM_WALLET,
        providerId: 'aave' as const,
        protocolId: 'aave-v3' as const,
        marketId: EVM_MARKET,
        chainAnchor: nullRecord({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '100',
          blockHash: EVM_BLOCK,
        }),
        currentHead: nullRecord({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '120',
          blockHash: EVM_CURRENT_BLOCK,
        }),
        finalizedHead: nullRecord({
          kind: 'EVM_BLOCK' as const,
          blockNumber: '110',
          blockHash: EVM_FINALIZED_BLOCK,
        }),
      })
    : frozen({
        networkId,
        transactionId: SOLANA_TRANSACTION,
        transactionBlockId: SOLANA_BLOCK,
        finalizedBlockId: SOLANA_FINALIZED_BLOCK,
        walletAddress: SOLANA_WALLET,
        providerId: 'kamino' as const,
        protocolId: 'kamino-lend' as const,
        marketId: SOLANA_MARKET,
        chainAnchor: nullRecord({ kind: 'SOLANA_SLOT' as const, slot: '100', root: '90' }),
        currentHead: nullRecord({ kind: 'SOLANA_SLOT' as const, slot: '120', root: '110' }),
        finalizedHead: nullRecord({ kind: 'SOLANA_SLOT' as const, slot: '110', root: '110' }),
      });
}

class ChainSource implements ProviderPositionChainAnchorEvidenceSourcePort {
  readonly sourceVersion = PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION;
  readonly requests: ReadProviderPositionChainAnchorEvidenceSourceRequestV1[] = [];
  readonly #issued = new WeakMap<object, ReadProviderPositionChainAnchorEvidenceSourceRequestV1>();

  constructor(
    private readonly expectedNetwork: Network,
    private readonly facts: Scenario,
    private readonly proofSeeds: readonly [string, string, string],
  ) {}

  async readAttestation(
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): Promise<unknown> {
    if (request.networkId !== this.expectedNetwork) throw new Error('unexpected network');
    this.requests.push(request);
    const capability = nullRecord({
      sourceVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_VERSION,
      use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_SOURCE_ATTESTATION_USE,
      mayAuthorizeFinancialAction: false as const,
      mayPersist: false as const,
      networkId: request.networkId,
      sourceFamilyId: request.sourceFamilyId,
      sourceId: request.sourceId,
      sourceKind: request.sourceKind,
      sourceObservationId: request.sourceObservationId,
      continuityFloor: request.continuityFloor,
      chainAnchor: request.chainAnchor,
      observedAt: request.observedAt,
      assessedAt: NOW,
      currentHead: this.facts.currentHead,
      currentHeadAdvancedAt: NOW,
      finalizedHead: this.facts.finalizedHead,
      finalizedHeadAdvancedAt: NOW,
      identityProofSha256: this.proofSeeds[0].repeat(64),
      liveCapabilityProofSha256: this.proofSeeds[1].repeat(64),
      lineageProofSha256: this.proofSeeds[2].repeat(64),
    });
    this.#issued.set(capability, request);
    return capability;
  }

  verifyAttestation(
    capability: unknown,
    request: ReadProviderPositionChainAnchorEvidenceSourceRequestV1,
  ): boolean {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      this.#issued.get(capability) === request
    );
  }
}

function sourcePairRegistry(): ProviderPositionChainAnchorEvidenceSourcePairRegistryV1 {
  const content = frozen({
    schemaVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
    environment: 'MAINNET' as const,
    approvalStatus: 'APPROVED' as const,
    pairs: frozen(
      [ETHEREUM, SOLANA].map((networkId) =>
        frozen({
          networkId,
          approvalId: networkId === ETHEREUM ? 'ethereum-pair-v1' : 'solana-pair-v1',
          approvedAt: '2026-09-07T11:00:00.000Z',
          expiresAt: SOURCE_PAIR_EXPIRY,
          primary: frozen({
            sourceFamilyId: 'alpha-family',
            sourceId: 'alpha-source',
            sourceKind: 'RPC' as const,
          }),
          corroborating: frozen({
            sourceFamilyId: 'beta-family',
            sourceId: 'beta-source',
            sourceKind: 'INDEXER' as const,
          }),
        }),
      ),
    ),
  }) satisfies ProviderPositionChainAnchorEvidenceSourcePairRegistryContentV1;
  return frozen({
    ...content,
    fingerprintSha256: fingerprintProviderPositionChainAnchorEvidenceSourcePairRegistryV1(content),
  });
}

function chainProducerFixture(selected: Scenario): Readonly<{
  producer: DormantProviderPositionChainAnchorEvidenceProducer;
  primary: ChainSource;
  corroborating: ChainSource;
  registry: ProviderPositionChainAnchorEvidenceSourcePairRegistryV1;
}> {
  const registry = sourcePairRegistry();
  const sources = new Map<string, ChainSource>();
  const bindings: ProviderPositionChainAnchorEvidenceSourceBindingV1[] = [];
  for (const networkId of [ETHEREUM, SOLANA] as const) {
    const facts = scenario(networkId);
    const primary = new ChainSource(networkId, facts, ['1', '2', '3']);
    const corroborating = new ChainSource(networkId, facts, ['4', '5', '6']);
    sources.set(`${networkId}:PRIMARY`, primary);
    sources.set(`${networkId}:CORROBORATING`, corroborating);
    bindings.push(
      frozen({
        networkId,
        role: 'PRIMARY' as const,
        sourceFamilyId: 'alpha-family',
        sourceId: 'alpha-source',
        sourceKind: 'RPC' as const,
        source: primary,
      }),
      frozen({
        networkId,
        role: 'CORROBORATING' as const,
        sourceFamilyId: 'beta-family',
        sourceId: 'beta-source',
        sourceKind: 'INDEXER' as const,
        source: corroborating,
      }),
    );
  }
  const primary = sources.get(`${selected.networkId}:PRIMARY`);
  const corroborating = sources.get(`${selected.networkId}:CORROBORATING`);
  if (primary === undefined || corroborating === undefined) throw new Error('missing chain source');
  return frozen({
    producer: new DormantProviderPositionChainAnchorEvidenceProducer(
      registry,
      frozen(bindings),
      frozen({ now: () => new Date(NOW) }),
    ),
    primary,
    corroborating,
    registry,
  });
}

class FinalitySource implements MainnetFinancialActionFinalityEvidenceSourcePort {
  readonly sourceVersion = MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_VERSION;
  readonly requests: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1[] = [];
  readonly #issued = new WeakMap<
    object,
    ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1
  >();

  constructor(
    private readonly facts: Scenario,
    private readonly seed: string,
  ) {}

  async readAttestation(
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): Promise<unknown> {
    if (request.purpose !== 'POST_FINALITY_REVIEW') throw new Error('unexpected purpose');
    this.requests.push(request);
    const { evaluatedAt, deadlineAt: _deadlineAt, signal: _signal, ...requestFacts } = request;
    void _deadlineAt;
    void _signal;
    const transactionPosition =
      request.chainAnchor.kind === 'EVM_BLOCK'
        ? request.chainAnchor.blockNumber
        : request.chainAnchor.slot;
    const finalizedPosition =
      request.agreedFinalizedHead.kind === 'EVM_BLOCK'
        ? request.agreedFinalizedHead.blockNumber
        : request.agreedFinalizedHead.root;
    const capability = nullRecord({
      ...requestFacts,
      use: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_SOURCE_ATTESTATION_USE,
      disposition: 'FINALITY_REAFFIRMED' as const,
      lineageStatus: 'CANONICAL' as const,
      transactionPosition,
      transactionBlockId: request.terminalTransactionBlockId,
      finalizedPosition,
      finalizedBlockId:
        request.agreedFinalizedHead.kind === 'EVM_BLOCK'
          ? request.agreedFinalizedHead.blockHash
          : this.facts.finalizedBlockId,
      transactionEvidenceSha256: this.seed.repeat(64),
      observedAt: evaluatedAt,
      assessedAt: evaluatedAt,
      attestationSha256: (this.seed === '7' ? '8' : '9').repeat(64),
    }) satisfies MainnetFinancialActionPostFinalityEvidenceSourceAttestationV1;
    this.#issued.set(capability, request);
    return capability;
  }

  verifyAttestation(
    capability: unknown,
    request: ReadMainnetFinancialActionFinalityEvidenceSourceRequestV1,
  ): boolean {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      this.#issued.get(capability) === request
    );
  }
}

function finalityBindings(
  facts: Scenario,
  primary: FinalitySource,
  corroborating: FinalitySource,
): readonly MainnetFinancialActionFinalityEvidenceSourceBindingV1[] {
  return frozen([
    frozen({
      networkId: facts.networkId,
      sourceAuthorityId: SOURCE_AUTHORITY_ID,
      sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
      role: 'PRIMARY' as const,
      sourceFamilyId: 'alpha-family',
      sourceId: 'alpha-source',
      sourceKind: 'RPC' as const,
      source: primary,
    }),
    frozen({
      networkId: facts.networkId,
      sourceAuthorityId: SOURCE_AUTHORITY_ID,
      sourceAuthorityFingerprintSha256: SOURCE_AUTHORITY_FINGERPRINT,
      role: 'CORROBORATING' as const,
      sourceFamilyId: 'beta-family',
      sourceId: 'beta-source',
      sourceKind: 'INDEXER' as const,
      source: corroborating,
    }),
  ]);
}

function encodedKey(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

type EnabledWalletRegistrationConfig = Extract<
  ReturnType<typeof loadWalletRegistrationConfig>,
  { readonly mode: 'enabled' }
>;

interface WalletFixture {
  readonly addressDigest: ActiveWalletRegistrationRecord['addressDigest'];
  readonly identityKeyRing: EnabledWalletRegistrationConfig['identityHmacKeys'];
  readonly listActiveWallets: jest.MockedFunction<
    WalletRegistrationRepositoryPort['listActiveWallets']
  >;
  readonly reader: WalletRegistrationMainnetFinancialActionFinalityWalletReader;
}

function walletFixture(facts: Scenario): Readonly<WalletFixture> {
  const config = loadWalletRegistrationConfig({
    NODE_ENV: 'test',
    AUTH_MODE: 'oidc',
    AUTH_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
    WALLET_REGISTRATION_MODE: 'enabled',
    WALLET_REGISTRATION_REGISTRY_ENVIRONMENT: 'MAINNET',
    WALLET_REGISTRATION_CHALLENGE_TTL_SECONDS: '300',
    WALLET_IDENTITY_HMAC_KEY_VERSION: '1',
    WALLET_IDENTITY_HMAC_KEY: encodedKey(1),
    WALLET_CHALLENGE_HMAC_KEY_VERSION: '1',
    WALLET_CHALLENGE_HMAC_KEY: encodedKey(2),
    WALLET_METADATA_SEAL_KEY_VERSION: '1',
    WALLET_METADATA_SEAL_KEY: encodedKey(3),
  });
  if (config.mode !== 'enabled') throw new Error('enabled wallet fixture expected');
  const accountId = parseAccountId(ACCOUNT_ID);
  const challengeId = parseWalletChallengeId(CHALLENGE_ID);
  const identityKey = activeWalletRegistrationKey(config.identityHmacKeys);
  const addressDigest = digestWalletIdentity(identityKey, facts.networkId, facts.walletAddress);
  const record: ActiveWalletRegistrationRecord = {
    walletId: WALLET_ID,
    accountId,
    registeredByChallengeId: challengeId,
    chainId: facts.networkId,
    registry: {
      environment: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.environment,
      version: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
      fingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    },
    addressDigest,
    verificationAddressDigest: addressDigest,
    encryptedAddress: sealWalletRegistrationValue(
      activeWalletRegistrationKey(config.metadataSealKeys),
      {
        field: 'address',
        walletId: WALLET_ID,
        challengeId,
        accountId,
        networkId: facts.networkId,
        addressDigest,
      },
      facts.walletAddress,
    ),
    registeredAt: new Date(REGISTERED_AT),
  };
  const listActiveWallets = jest.fn<
    ReturnType<WalletRegistrationRepositoryPort['listActiveWallets']>,
    Parameters<WalletRegistrationRepositoryPort['listActiveWallets']>
  >(() => Promise.resolve(Object.freeze([record])));
  const repository = {
    listActiveWallets,
    revokeWallet: jest.fn(),
    beginChallenge: jest.fn(),
    prepareChallenge: jest.fn(),
    rejectChallenge: jest.fn(),
    completeRegistration: jest.fn(),
  } as unknown as WalletRegistrationRepositoryPort;
  const service = new WalletRegistrationService(repository, config, {
    now: () => new Date(NOW),
  });
  return frozen({
    addressDigest,
    identityKeyRing: config.identityHmacKeys,
    listActiveWallets,
    reader: new WalletRegistrationMainnetFinancialActionFinalityWalletReader(service, {
      now: () => new Date(NOW),
    }),
  });
}

function lifecycleRow(
  facts: Scenario,
  wallet: ReturnType<typeof walletFixture>,
): Record<string, unknown> {
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const asset = registry.assets.find(
    (candidate) => candidate.networkId === facts.networkId && candidate.stablecoin === 'USDC',
  );
  if (asset === undefined) throw new Error('mainnet USDC fixture asset missing');
  const ethereum = facts.networkId === ETHEREUM;
  return {
    record_outcome: 'READ',
    result_intent_id: INTENT_ID,
    lifecycle_stage: 'FINALIZED_SUCCESS',
    lifecycle_revision: '3',
    current_snapshot_sha256: TERMINAL_SNAPSHOT,
    intent_record_fingerprint_sha256: INTENT_FINGERPRINT,
    volatile_intent_commitment_sha256: VOLATILE_COMMITMENT,
    fingerprint_encoding_version: 1,
    account_id: ACCOUNT_ID,
    yield_operation_id: YIELD_OPERATION_ID,
    yield_submission_id: YIELD_SUBMISSION_ID,
    ledger_transaction_id: LEDGER_TRANSACTION_ID,
    ledger_book_id: LEDGER_BOOK_ID,
    wallet_id: WALLET_ID,
    wallet_chain_namespace: ethereum ? 'eip155' : 'solana',
    wallet_chain_reference: ethereum ? '1' : '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    wallet_identity_digest_version: wallet.addressDigest.version,
    wallet_identity_digest_hex: wallet.addressDigest.value,
    network_id: facts.networkId,
    provider_id: facts.providerId,
    protocol_id: facts.protocolId,
    market_id: facts.marketId,
    asset_registry_version: registry.version,
    asset_registry_fingerprint_sha256: registry.fingerprintSha256,
    asset_symbol: asset.stablecoin,
    asset_identity: asset.identity,
    asset_decimals: asset.decimals,
    action_type: 'SUPPLY',
    amount_atomic: '1000000',
    requested_value_usd_micros: '1000000',
    maximum_network_fee_atomic: '10000',
    maximum_network_fee_basis_points: 50,
    minimum_post_action_native_balance_atomic: '1',
    allowance_mode: 'EXACT',
    allowance_amount_atomic: '1000000',
    idempotency_key_digest_sha256: IDEMPOTENCY_DIGEST,
    replay_protection_id: REPLAY_ID,
    chain_transaction_id: facts.transactionId,
    submission_fingerprint_sha256: SUBMISSION_FINGERPRINT,
    observation_id: OBSERVATION_ID,
    broadcast_outcome: null,
    reconciliation_outcome: 'FINALIZED_SUCCESS',
    transaction_position: '100',
    transaction_block_id: facts.transactionBlockId,
    transaction_block_identity_sha256: TRANSACTION_BLOCK_IDENTITY,
    finalized_position: '110',
    finalized_block_id: facts.finalizedBlockId,
    finalized_block_identity_sha256: FINALIZED_BLOCK_IDENTITY,
    last_observed_transaction_position: '100',
    last_observed_transaction_block_id: facts.transactionBlockId,
    last_observed_transaction_block_identity_sha256: TRANSACTION_BLOCK_IDENTITY,
    effective_at: OBSERVED_AT,
    expires_at: OBSERVED_AT,
    terminal: true,
    requires_manual_reconciliation: false,
    database_replay_protection_enforced: true,
    ledger_settlement_authority: false,
    recorded_at: NOW,
  };
}

function recorderRow(state: 'NEW' | 'RECORD_DISPATCHED' | 'RECORDED'): Record<string, unknown> {
  const terminal = state === 'RECORDED';
  return {
    intent_state: state,
    record_intent_fingerprint_sha256: RECORD_INTENT_FINGERPRINT,
    evidence_fingerprint_sha256: CHAIN_EVIDENCE_FINGERPRINT,
    read_binding_fingerprint_sha256: READ_BINDING_FINGERPRINT,
    deadline_binding_sha256: terminal ? DEADLINE_BINDING_FINGERPRINT : null,
    evidence_recorded_at: terminal ? NOW : null,
    resolved_at: terminal ? NOW : null,
    producer_deadline_at: DEADLINE,
  };
}

function safetyRow(facts: Scenario): Record<string, unknown> {
  return {
    lifecycle_stage: 'FINALIZED_SUCCESS',
    network_id: facts.networkId,
    lifecycle_revision: '3',
    current_snapshot_sha256: TERMINAL_SNAPSHOT,
    current_transition_fingerprint_sha256: TERMINAL_TRANSITION_FINGERPRINT,
    admission_fingerprint_sha256: ORIGINAL_ADMISSION_FINGERPRINT,
    chain_transaction_id: facts.transactionId,
    transaction_position: '100',
    transaction_block_id: facts.transactionBlockId,
    authenticated_reconciliation: true,
    review_revision: '0',
    review_fingerprint_sha256: null,
    latest_review_disposition: null,
    effective_safety_state: 'AUTHENTICATED_FINALITY_RECORDED',
    requires_manual_review: false,
    may_authorize_financial_action: false,
    may_resend_transaction: false,
    ledger_settlement_authority: false,
  };
}

function persistedReviewRow(): Record<string, unknown> {
  return {
    record_outcome: 'RECORDED',
    review_fingerprint_sha256: 'a1'.repeat(32),
    review_revision: '1',
    current_review_revision: '1',
    current_review_fingerprint_sha256: 'a1'.repeat(32),
    current_review_disposition: 'FINALITY_REAFFIRMED',
    effective_safety_state: 'AUTHENTICATED_FINALITY_RECORDED',
    requires_manual_review: false,
    ledger_settlement_authority: false,
    recorded_at: NOW,
  };
}

type PrerequisiteRow = Record<
  (typeof MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_DATABASE_ROW_COLUMNS)[number],
  unknown
>;

function prerequisiteRow(
  facts: Scenario,
  wallet: ReturnType<typeof walletFixture>,
  sourceRegistry: ProviderPositionChainAnchorEvidenceSourcePairRegistryV1,
): PrerequisiteRow {
  const registry = MAINNET_SUPPORTED_ASSET_REGISTRY.latest;
  const asset = registry.assets.find(
    (candidate) => candidate.networkId === facts.networkId && candidate.stablecoin === 'USDC',
  );
  const pair = sourceRegistry.pairs.find((candidate) => candidate.networkId === facts.networkId);
  if (asset === undefined || pair === undefined) throw new Error('mainnet fixture binding missing');
  return {
    account_id: ACCOUNT_ID,
    intent_id: INTENT_ID,
    intent_record_fingerprint_sha256: INTENT_FINGERPRINT,
    wallet_registration_id: WALLET_ID,
    wallet_identity_digest_version: wallet.addressDigest.version,
    wallet_identity_digest_hex: wallet.addressDigest.value,
    network_id: facts.networkId,
    lifecycle_revision: '3',
    lifecycle_snapshot_sha256: TERMINAL_SNAPSHOT,
    lifecycle_stage: 'FINALIZED_SUCCESS',
    transaction_id: facts.transactionId,
    wallet_signed_payload_sha256: WALLET_PAYLOAD,
    wallet_signature_evidence_sha256: WALLET_SIGNATURE,
    chain_anchor_evidence_fingerprint_sha256: CHAIN_EVIDENCE_FINGERPRINT,
    chain_anchor_json: JSON.stringify(facts.chainAnchor),
    agreed_finalized_head_json: JSON.stringify(facts.finalizedHead),
    chain_anchor_evidence_expires_at: AUTHORITY_EXPIRY,
    source_authority_id: SOURCE_AUTHORITY_ID,
    source_authority_fingerprint_sha256: SOURCE_AUTHORITY_FINGERPRINT,
    source_authority_expires_at: AUTHORITY_EXPIRY,
    source_pair_approval_id: pair.approvalId,
    source_pair_registry_fingerprint_sha256: sourceRegistry.fingerprintSha256,
    primary_source_family_id: pair.primary.sourceFamilyId,
    primary_source_id: pair.primary.sourceId,
    primary_source_kind: pair.primary.sourceKind,
    corroborating_source_family_id: pair.corroborating.sourceFamilyId,
    corroborating_source_id: pair.corroborating.sourceId,
    corroborating_source_kind: pair.corroborating.sourceKind,
    deployment_authority_id: DEPLOYMENT_AUTHORITY_ID,
    deployment_authority_fingerprint_sha256: DEPLOYMENT_AUTHORITY_FINGERPRINT,
    deployment_authority_expires_at: AUTHORITY_EXPIRY,
    primary_deployment_manifest_fingerprint_sha256: PRIMARY_DEPLOYMENT_MANIFEST,
    primary_observed_identity_fingerprint_sha256: PRIMARY_OBSERVED_IDENTITY,
    corroborating_deployment_manifest_fingerprint_sha256: CORROBORATING_DEPLOYMENT_MANIFEST,
    corroborating_observed_identity_fingerprint_sha256: CORROBORATING_OBSERVED_IDENTITY,
    provider_id: facts.providerId,
    protocol_id: facts.protocolId,
    market_id: facts.marketId,
    asset_registry_version: registry.version,
    asset_registry_fingerprint_sha256: registry.fingerprintSha256,
    asset_symbol: asset.stablecoin,
    asset_identity: asset.identity,
    asset_decimals: asset.decimals,
    action_type: 'SUPPLY',
    amount_atomic: '1000000',
    terminal_transition_fingerprint_sha256: TERMINAL_TRANSITION_FINGERPRINT,
    original_admission_fingerprint_sha256: ORIGINAL_ADMISSION_FINGERPRINT,
    terminal_transaction_position: '100',
    terminal_transaction_block_id: facts.transactionBlockId,
    expected_review_revision: '0',
    expected_previous_review_fingerprint_sha256: null,
    effective_safety_state: 'AUTHENTICATED_FINALITY_RECORDED',
    verified_at: NOW,
  };
}

describe('dormant mainnet finality real-class composition', () => {
  it.each([ETHEREUM, SOLANA] as const)(
    'composes current ACTIVE %s wallet, lifecycle, chain evidence, safety, issuer, and post-finality producer',
    async (networkId) => {
      const facts = scenario(networkId);
      const wallet = walletFixture(facts);
      const chain = chainProducerFixture(facts);
      const scriptedRows: unknown[] = [
        lifecycleRow(facts, wallet),
        recorderRow('NEW'),
        recorderRow('RECORD_DISPATCHED'),
        recorderRow('RECORDED'),
        safetyRow(facts),
        prerequisiteRow(facts, wallet, chain.registry),
        persistedReviewRow(),
      ];
      let databaseCall = 0;
      const queryWithCancellation = jest.fn<
        Promise<unknown>,
        [string, readonly unknown[], AbortSignal]
      >(() => {
        const row = scriptedRows[databaseCall];
        databaseCall += 1;
        return row === undefined
          ? Promise.reject(new Error('unexpected database call'))
          : Promise.resolve({ rows: [row] });
      });
      const postgres = { queryWithCancellation } as unknown as PostgresService;
      const signal = new AbortController().signal;
      const clock = frozen({ now: () => new Date(NOW) });

      const lifecycle = new PostgresDormantMainnetFinancialActionLifecycleDurableAdapter(
        postgres,
        clock,
        wallet.identityKeyRing,
      );
      const lifecycleRequest = nullRecord({
        durableLifecycleVersion: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_LIFECYCLE_VERSION,
        use: DORMANT_MAINNET_FINANCIAL_ACTION_DURABLE_REQUEST_USE,
        mayAuthorizeFinancialAction: false as const,
        accountId: ACCOUNT_ID,
        intentId: INTENT_ID,
        signal,
      }) satisfies ReadDormantMainnetFinancialActionDurableRequestV1;
      const lifecycleCapability = await lifecycle.read(lifecycleRequest);
      expect(lifecycle.reviewResult(lifecycleCapability, lifecycleRequest)).toBe(
        lifecycleCapability,
      );

      const producerRequest = nullRecord({
        producerVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCER_VERSION,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_PRODUCE_USE,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        networkId,
        sourceFamilyId: 'alpha-family',
        sourceId: 'alpha-source',
        sourceKind: 'RPC' as const,
        sourceObservationId:
          facts.chainAnchor.kind === 'EVM_BLOCK'
            ? `ethereum-block-${facts.chainAnchor.blockNumber}`
            : `solana-slot-${facts.chainAnchor.slot}`,
        continuityFloor: facts.chainAnchor,
        chainAnchor: facts.chainAnchor,
        observedAt: OBSERVED_AT,
        deadlineAt: DEADLINE,
        signal,
      }) satisfies ProduceProviderPositionChainAnchorEvidenceRequestV1;
      const producerCapability = await chain.producer.produceCandidate(producerRequest);
      const recorder = new PostgresProviderPositionChainAnchorEvidenceRecorder(
        chain.producer,
        postgres,
      );
      const chainEvidenceRequest = nullRecord({
        recorderVersion: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORDER_VERSION,
        use: PROVIDER_POSITION_CHAIN_ANCHOR_EVIDENCE_RECORD_USE,
        mayAuthorizeFinancialAction: false as const,
        producerCapability,
        producerRequest,
        signal,
      }) satisfies RecordProviderPositionChainAnchorEvidenceRequestV2;
      const chainEvidenceCapability = await recorder.recordEvidence(chainEvidenceRequest);
      expect(recorder.reviewResult(chainEvidenceCapability, chainEvidenceRequest)).toMatchObject({
        outcome: 'RECORDED',
        evidenceFingerprintSha256: CHAIN_EVIDENCE_FINGERPRINT,
      });

      const safetyReader = new PostgresDormantMainnetFinancialActionEffectiveSafetyReaderAdapter(
        postgres,
      );
      const effectiveSafetyRequest = nullRecord({
        accountId: ACCOUNT_ID,
        intentId: INTENT_ID,
        signal,
      }) satisfies ReadMainnetFinancialActionEffectiveSafetyStateRequestV1;
      const effectiveSafetyCapability =
        await safetyReader.readEffectiveSafetyState(effectiveSafetyRequest);
      const effectiveSafetyResult = safetyReader.reviewResult(
        effectiveSafetyCapability,
        effectiveSafetyRequest,
      );
      expect(effectiveSafetyResult).toBe(effectiveSafetyCapability);
      if (
        effectiveSafetyResult?.outcome !== 'DATABASE_STATE_CONFIRMED' ||
        effectiveSafetyResult.operation !== 'READ_EFFECTIVE_SAFETY_STATE' ||
        effectiveSafetyResult.cursor === null
      ) {
        throw new Error('eligible effective-safety cursor expected');
      }

      const issuer = new PostgresDormantMainnetFinancialActionFinalityPrerequisiteAdapter(
        lifecycle,
        recorder,
        safetyReader,
        wallet.reader,
        postgres,
        clock,
      );
      const issueRequest = nullRecord({
        issuerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_PREREQUISITE_ISSUER_VERSION,
        use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_PREREQUISITE_ISSUE_USE,
        purpose: 'POST_FINALITY_REVIEW' as const,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        lifecycleCapability,
        lifecycleRequest,
        chainEvidenceCapability,
        chainEvidenceRequest,
        correlationId: CORRELATION_ID,
        deadlineAt: DEADLINE,
        signal,
        reviewId: REVIEW_ID,
        effectiveSafetyCapability,
        effectiveSafetyRequest,
      }) satisfies IssueMainnetFinancialActionPostFinalityPrerequisiteRequestV1;
      const opaqueIssuance = await issuer.issuePostFinalityPrerequisite(issueRequest);
      const issuance = issuer.reviewIssuance(opaqueIssuance, issueRequest);
      expect(issuance).not.toBeNull();
      if (issuance === null || issuance.purpose !== 'POST_FINALITY_REVIEW') {
        throw new Error('post-finality issuance expected');
      }
      expect(Reflect.ownKeys(issuance.prerequisiteCapability)).toEqual([]);
      expect(Object.getPrototypeOf(issuance.prerequisiteCapability)).toBeNull();
      expect(Object.isFrozen(issuance.prerequisiteCapability)).toBe(true);
      expect(JSON.stringify(issuance)).not.toContain(facts.walletAddress);
      expect(JSON.stringify(issuance)).not.toContain(wallet.addressDigest.value);

      const primaryFinality = new FinalitySource(facts, '7');
      const corroboratingFinality = new FinalitySource(facts, 'a');
      const finality = new DormantMainnetFinancialActionFinalityEvidenceProducer(
        issuer,
        finalityBindings(facts, primaryFinality, corroboratingFinality),
        clock,
      );
      const persistence = safetyReader.bindPersistence(finality);
      const finalityRequest = nullRecord({
        producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
        use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_EVIDENCE_PRODUCE_USE,
        purpose: 'POST_FINALITY_REVIEW' as const,
        mayAuthorizeFinancialAction: false as const,
        mayPersist: false as const,
        prerequisiteCapability: issuance.prerequisiteCapability,
        prerequisiteRequest: issuance.prerequisiteRequest,
        signal,
      }) satisfies ProduceMainnetFinancialActionPostFinalityEvidenceRequestV1;
      const candidate = await finality.producePostFinalityReviewCandidate(finalityRequest);
      const reviewed = finality.reviewPostFinalityReviewCandidate(candidate, finalityRequest);

      expect(reviewed).toBe(candidate);
      expect(Object.isFrozen(reviewed)).toBe(true);
      expect(Object.getPrototypeOf(reviewed)).toBeNull();
      expect(reviewed).toMatchObject({
        producerVersion: MAINNET_FINANCIAL_ACTION_FINALITY_EVIDENCE_PRODUCER_VERSION,
        use: MAINNET_FINANCIAL_ACTION_POST_FINALITY_REVIEW_CANDIDATE_USE,
        purpose: 'POST_FINALITY_REVIEW',
        mayAuthorizeFinancialAction: false,
        mayPersist: false,
        effectiveSafetyBinding: {
          terminalTransitionFingerprintSha256: TERMINAL_TRANSITION_FINGERPRINT,
          originalAdmissionFingerprintSha256: ORIGINAL_ADMISSION_FINGERPRINT,
          expectedReviewRevision: '0',
          expectedPreviousReviewFingerprintSha256: null,
          effectiveSafetyState: 'AUTHENTICATED_FINALITY_RECORDED',
        },
      });
      expect(reviewed.reviewArguments.slice(0, 19)).toEqual([
        ACCOUNT_ID,
        INTENT_ID,
        '3',
        TERMINAL_SNAPSHOT,
        '0',
        null,
        REVIEW_ID,
        'FINALITY_REAFFIRMED',
        'CANONICAL',
        facts.transactionId,
        '100',
        facts.transactionBlockId,
        '110',
        facts.finalizedBlockId,
        CHAIN_EVIDENCE_FINGERPRINT,
        SOURCE_AUTHORITY_ID,
        SOURCE_AUTHORITY_FINGERPRINT,
        DEPLOYMENT_AUTHORITY_ID,
        DEPLOYMENT_AUTHORITY_FINGERPRINT,
      ]);
      expect(reviewed.reviewArguments.slice(22)).toEqual([NOW, DEADLINE, CORRELATION_ID]);

      const persistenceRequest = nullRecord({
        evidenceCapability: candidate,
        evidenceRequest: finalityRequest,
        effectiveSafetyCursor: effectiveSafetyResult.cursor,
        effectiveSafetyReadRequest: effectiveSafetyRequest,
        signal,
      }) satisfies RecordMainnetFinancialActionPostFinalityReviewRequestV1;
      const persistenceCapability = await persistence.recordPostFinalityReview(persistenceRequest);
      expect(persistence.reviewResult(persistenceCapability, persistenceRequest)).toMatchObject({
        outcome: 'DATABASE_STATE_CONFIRMED',
        operation: 'RECORD_POST_FINALITY_REVIEW',
        databaseRecordOutcome: 'RECORDED',
        recordedReviewRevision: '1',
        recordedReviewDisposition: 'FINALITY_REAFFIRMED',
        effectiveSafetyState: 'AUTHENTICATED_FINALITY_RECORDED',
        ledgerSettlementAuthority: false,
        recoveryMode: 'READ_ONLY',
      });
      await expect(persistence.recordPostFinalityReview(persistenceRequest)).rejects.toBe(
        DORMANT_MAINNET_FINANCIAL_ACTION_FINALITY_SIDECAR_UNAVAILABLE,
      );

      expect(queryWithCancellation).toHaveBeenCalledTimes(7);
      expect(databaseCall).toBe(scriptedRows.length);
      for (const call of queryWithCancellation.mock.calls) expect(call[2]).toBe(signal);
      expect(chain.primary.requests).toHaveLength(1);
      expect(chain.corroborating.requests).toHaveLength(1);
      expect(chain.primary.requests[0]?.signal).toBe(signal);
      expect(chain.corroborating.requests[0]?.signal).toBe(signal);
      expect(primaryFinality.requests).toHaveLength(1);
      expect(corroboratingFinality.requests).toHaveLength(1);
      expect(primaryFinality.requests[0]?.signal).toBe(signal);
      expect(corroboratingFinality.requests[0]?.signal).toBe(signal);
      expect(wallet.listActiveWallets).toHaveBeenCalledTimes(1);
      expect(wallet.listActiveWallets.mock.calls[0]?.[0]).toEqual({
        accountId: parseAccountId(ACCOUNT_ID),
        signal,
      });
    },
  );
});
