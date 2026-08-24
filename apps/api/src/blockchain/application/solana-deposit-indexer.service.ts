import {
  CHAIN_OBSERVATION_RESILIENCE_POLICY,
  chainObservationPolicyForNetwork,
  isExpectedChainIdentity,
  observationTierRule,
  type ChainObservationNetworkId,
} from '../domain/chain-observation-policy';
import {
  supportedAssetRegistryForEnvironment,
  type AssetRegistryEnvironment,
  type SupportedStablecoin,
  type SupportedStablecoinAsset,
} from '../domain/supported-asset-registry';
import {
  normalizeSolanaPublicKey,
  parseSolanaTokenAccount,
  SOLANA_TOKEN_PROGRAM_IDS,
  SolanaTokenAccountValidationError,
  type SolanaTokenProgramId,
} from '../domain/solana-token-account';
import type {
  SolanaDepositCommitment,
  SolanaDepositSourcePort,
  SolanaDepositSourceRequestContext,
  SolanaTokenAccountsByOwnerRequest,
} from './ports/solana-deposit-source.port';

const MAX_SLOT = 18_446_744_073_709_551_615n;
const MAX_READ_UNITS = CHAIN_OBSERVATION_RESILIENCE_POLICY.recovery.maxReadUnitsPerJob;

export type SolanaDepositIndexTier = 'PROVISIONAL' | 'CANONICAL';

export type SolanaDepositIndexerErrorCode =
  | 'INVALID_ENVIRONMENT'
  | 'UNSUPPORTED_NETWORK'
  | 'ENVIRONMENT_MISMATCH'
  | 'INVALID_OWNER_ADDRESS'
  | 'INVALID_MIN_CONTEXT_SLOT'
  | 'TIER_NOT_AVAILABLE'
  | 'LIVE_CAPABILITY_PROOF_REQUIRED'
  | 'SOURCE_READ_FAILED'
  | 'IDENTITY_MISMATCH'
  | 'INVALID_SOURCE_RESPONSE'
  | 'SOURCE_SLOT_REGRESSION'
  | 'INCOHERENT_SOURCE_SLOTS'
  | 'READ_UNIT_LIMIT_EXCEEDED'
  | 'DUPLICATE_TOKEN_ACCOUNT';

export class SolanaDepositIndexerError extends Error {
  constructor(readonly code: SolanaDepositIndexerErrorCode) {
    super(code);
    this.name = 'SolanaDepositIndexerError';
  }
}

export interface SolanaCanonicalReadCapability {
  readonly networkId: ChainObservationNetworkId;
  readonly confirmedTokenAccountReadsValidated: true;
}

export interface SolanaDepositIndexRequest {
  readonly environment: AssetRegistryEnvironment;
  readonly networkId: string;
  readonly ownerAddress: string;
  readonly tier: SolanaDepositIndexTier;
  readonly minContextSlot?: bigint;
  readonly canonicalReadCapability?: SolanaCanonicalReadCapability;
  readonly signal?: AbortSignal;
}

export interface IndexedSolanaStablecoinBalance {
  readonly assetId: string;
  readonly stablecoin: SupportedStablecoin;
  readonly mintAddress: string;
  readonly decimals: number;
  readonly amountBaseUnits: bigint;
  readonly activeAmountBaseUnits: bigint;
  readonly frozenAmountBaseUnits: bigint;
  readonly activeTokenAccountCount: number;
  readonly frozenTokenAccountCount: number;
  readonly sourceSlot: bigint;
}

export interface SolanaDepositExclusionCounts {
  readonly closedAccounts: number;
  readonly uninitializedAccounts: number;
  readonly unsupportedMintAccounts: number;
}

export interface SolanaDepositIndexResult {
  readonly completeness: 'COMPLETE';
  readonly authority: 'DISPLAY_ONLY' | 'CANONICAL_INDEXING';
  readonly tier: SolanaDepositIndexTier;
  readonly commitment: SolanaDepositCommitment;
  readonly environment: AssetRegistryEnvironment;
  readonly networkId: ChainObservationNetworkId;
  readonly ownerAddress: string;
  readonly sourceSlot: bigint;
  readonly registryVersion: number;
  readonly registryFingerprintSha256: string;
  readonly sourceAccountCount: number;
  readonly balances: readonly IndexedSolanaStablecoinBalance[];
  readonly exclusions: SolanaDepositExclusionCounts;
}

interface ParsedSourceAccount {
  readonly address: string;
  readonly programId: SolanaTokenProgramId;
  readonly data: Uint8Array | null;
}

interface ParsedSourceResponse {
  readonly contextSlot: bigint;
  readonly accounts: readonly ParsedSourceAccount[];
}

interface MutableBalance {
  amountBaseUnits: bigint;
  activeAmountBaseUnits: bigint;
  frozenAmountBaseUnits: bigint;
  activeTokenAccountCount: number;
  frozenTokenAccountCount: number;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownValue(record: Record<PropertyKey, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
  }
  return descriptor.value;
}

function parseSlot(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_SLOT) {
    throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
  }
  return value;
}

function parseAccount(
  value: unknown,
  expectedProgramId: SolanaTokenProgramId,
): ParsedSourceAccount {
  if (!isRecord(value)) throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
  const addressValue = ownValue(value, 'address');
  const programIdValue = ownValue(value, 'programId');
  const dataValue = ownValue(value, 'data');
  if (typeof addressValue !== 'string' || programIdValue !== expectedProgramId) {
    throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
  }

  let address: string;
  try {
    address = normalizeSolanaPublicKey(addressValue);
  } catch (error: unknown) {
    if (error instanceof SolanaTokenAccountValidationError) {
      throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
    }
    throw error;
  }

  if (dataValue !== null && Object.prototype.toString.call(dataValue) !== '[object Uint8Array]') {
    throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
  }
  return Object.freeze({
    address,
    programId: expectedProgramId,
    data: dataValue === null ? null : Uint8Array.from(dataValue as Uint8Array),
  });
}

function parseSourceResponse(
  value: unknown,
  expectedProgramId: SolanaTokenProgramId,
): ParsedSourceResponse {
  if (!isRecord(value)) throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
  const contextSlot = parseSlot(ownValue(value, 'contextSlot'));
  const accountsValue = ownValue(value, 'accounts');
  if (!Array.isArray(accountsValue) || accountsValue.length > MAX_READ_UNITS) {
    throw new SolanaDepositIndexerError(
      Array.isArray(accountsValue) ? 'READ_UNIT_LIMIT_EXCEEDED' : 'INVALID_SOURCE_RESPONSE',
    );
  }
  return Object.freeze({
    contextSlot,
    accounts: Object.freeze(
      accountsValue.map((account) => parseAccount(account, expectedProgramId)),
    ),
  });
}

function commitmentForTier(tier: unknown): SolanaDepositCommitment {
  if (tier === 'PROVISIONAL') return 'processed';
  if (tier === 'CANONICAL') return 'confirmed';
  throw new SolanaDepositIndexerError('TIER_NOT_AVAILABLE');
}

function validateMinContextSlot(value: bigint | undefined): void {
  if (value !== undefined && (typeof value !== 'bigint' || value < 0n || value > MAX_SLOT)) {
    throw new SolanaDepositIndexerError('INVALID_MIN_CONTEXT_SLOT');
  }
}

function makeSourceContext(signal: AbortSignal | undefined): SolanaDepositSourceRequestContext {
  return signal === undefined ? {} : { signal };
}

function makeTokenAccountRequest(
  request: SolanaDepositIndexRequest,
  ownerAddress: string,
  programId: SolanaTokenProgramId,
  commitment: SolanaDepositCommitment,
): SolanaTokenAccountsByOwnerRequest {
  return {
    ownerAddress,
    tokenProgramId: programId,
    commitment,
    ...(request.minContextSlot === undefined ? {} : { minContextSlot: request.minContextSlot }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}

function emptyBalance(): MutableBalance {
  return {
    amountBaseUnits: 0n,
    activeAmountBaseUnits: 0n,
    frozenAmountBaseUnits: 0n,
    activeTokenAccountCount: 0,
    frozenTokenAccountCount: 0,
  };
}

export class SolanaDepositIndexerService {
  constructor(private readonly source: SolanaDepositSourcePort) {}

  async index(request: SolanaDepositIndexRequest): Promise<SolanaDepositIndexResult> {
    const policy = chainObservationPolicyForNetwork(request.networkId);
    if (policy?.chain !== 'SOLANA') throw new SolanaDepositIndexerError('UNSUPPORTED_NETWORK');
    if (request.environment !== 'MAINNET' && request.environment !== 'TESTNET') {
      throw new SolanaDepositIndexerError('INVALID_ENVIRONMENT');
    }
    if (policy.environment !== request.environment) {
      throw new SolanaDepositIndexerError('ENVIRONMENT_MISMATCH');
    }
    validateMinContextSlot(request.minContextSlot);

    let ownerAddress: string;
    try {
      ownerAddress = normalizeSolanaPublicKey(request.ownerAddress);
    } catch (error: unknown) {
      if (error instanceof SolanaTokenAccountValidationError) {
        throw new SolanaDepositIndexerError('INVALID_OWNER_ADDRESS');
      }
      throw error;
    }

    const commitment = commitmentForTier(request.tier);
    const tierRule = observationTierRule(request.networkId, request.tier);
    if (tierRule === undefined || tierRule.authority === 'FINANCIAL_AND_LEDGER') {
      throw new SolanaDepositIndexerError('TIER_NOT_AVAILABLE');
    }
    if (
      request.tier === 'CANONICAL' &&
      (request.canonicalReadCapability?.networkId !== request.networkId ||
        request.canonicalReadCapability.confirmedTokenAccountReadsValidated !== true)
    ) {
      throw new SolanaDepositIndexerError('LIVE_CAPABILITY_PROOF_REQUIRED');
    }

    const genesisHash = await this.readSource(() =>
      this.source.getGenesisHash(makeSourceContext(request.signal)),
    );
    if (!isExpectedChainIdentity(request.networkId, genesisHash)) {
      throw new SolanaDepositIndexerError('IDENTITY_MISMATCH');
    }

    const responses = await Promise.all(
      Object.values(SOLANA_TOKEN_PROGRAM_IDS).map(async (programId) => {
        const sourceValue = await this.readSource(() =>
          this.source.getTokenAccountsByOwner(
            makeTokenAccountRequest(request, ownerAddress, programId, commitment),
          ),
        );
        return this.parseSourceResponse(sourceValue, programId);
      }),
    );
    const legacyResponse = responses[0];
    const token2022Response = responses[1];
    if (legacyResponse === undefined || token2022Response === undefined) {
      throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
    }
    if (legacyResponse.contextSlot !== token2022Response.contextSlot) {
      throw new SolanaDepositIndexerError('INCOHERENT_SOURCE_SLOTS');
    }
    const sourceSlot = legacyResponse.contextSlot;
    if (request.minContextSlot !== undefined && sourceSlot < request.minContextSlot) {
      throw new SolanaDepositIndexerError('SOURCE_SLOT_REGRESSION');
    }

    const accounts = [...legacyResponse.accounts, ...token2022Response.accounts];
    if (accounts.length > MAX_READ_UNITS) {
      throw new SolanaDepositIndexerError('READ_UNIT_LIMIT_EXCEEDED');
    }
    const registry = supportedAssetRegistryForEnvironment(request.environment);
    const assets = registry.latest.assets.filter(
      (asset) =>
        asset.chain === 'SOLANA' &&
        asset.networkId === request.networkId &&
        asset.activationState === 'ACTIVE',
    );
    const balancesByMint = new Map(assets.map((asset) => [asset.identity, emptyBalance()]));
    const seenAccounts = new Set<string>();
    let closedAccounts = 0;
    let uninitializedAccounts = 0;
    let unsupportedMintAccounts = 0;

    for (const account of accounts) {
      if (seenAccounts.has(account.address)) {
        throw new SolanaDepositIndexerError('DUPLICATE_TOKEN_ACCOUNT');
      }
      seenAccounts.add(account.address);
      if (account.data === null) {
        closedAccounts += 1;
        continue;
      }

      let parsed;
      try {
        parsed = parseSolanaTokenAccount({
          data: account.data,
          tokenProgramId: account.programId,
          expectedOwner: ownerAddress,
        });
      } catch (error: unknown) {
        if (error instanceof SolanaTokenAccountValidationError) {
          throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
        }
        throw error;
      }
      const asset = registry.normalizeAsset(request.networkId, parsed.mint);
      if (asset?.chain !== 'SOLANA') {
        unsupportedMintAccounts += 1;
        continue;
      }
      if (parsed.state === 'UNINITIALIZED') {
        uninitializedAccounts += 1;
        continue;
      }

      const balance = balancesByMint.get(asset.identity);
      if (balance === undefined) throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
      balance.amountBaseUnits += parsed.amountBaseUnits;
      if (parsed.state === 'ACTIVE') {
        balance.activeAmountBaseUnits += parsed.amountBaseUnits;
        balance.activeTokenAccountCount += 1;
      } else {
        balance.frozenAmountBaseUnits += parsed.amountBaseUnits;
        balance.frozenTokenAccountCount += 1;
      }
    }

    return Object.freeze({
      completeness: 'COMPLETE',
      authority: tierRule.authority,
      tier: request.tier,
      commitment,
      environment: request.environment,
      networkId: policy.networkId,
      ownerAddress,
      sourceSlot,
      registryVersion: registry.latest.version,
      registryFingerprintSha256: registry.latest.fingerprintSha256,
      sourceAccountCount: accounts.length,
      balances: Object.freeze(
        assets.map((asset) => this.toIndexedBalance(asset, balancesByMint, sourceSlot)),
      ),
      exclusions: Object.freeze({
        closedAccounts,
        uninitializedAccounts,
        unsupportedMintAccounts,
      }),
    });
  }

  private async readSource(read: () => Promise<unknown>): Promise<unknown> {
    try {
      return await read();
    } catch {
      throw new SolanaDepositIndexerError('SOURCE_READ_FAILED');
    }
  }

  private parseSourceResponse(
    value: unknown,
    expectedProgramId: SolanaTokenProgramId,
  ): ParsedSourceResponse {
    try {
      return parseSourceResponse(value, expectedProgramId);
    } catch (error: unknown) {
      if (error instanceof SolanaDepositIndexerError) throw error;
      throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
    }
  }

  private toIndexedBalance(
    asset: SupportedStablecoinAsset,
    balancesByMint: ReadonlyMap<string, MutableBalance>,
    sourceSlot: bigint,
  ): IndexedSolanaStablecoinBalance {
    const balance = balancesByMint.get(asset.identity);
    if (balance === undefined) throw new SolanaDepositIndexerError('INVALID_SOURCE_RESPONSE');
    return Object.freeze({
      assetId: asset.qualifiedIdentity,
      stablecoin: asset.stablecoin,
      mintAddress: asset.identity,
      decimals: asset.decimals,
      amountBaseUnits: balance.amountBaseUnits,
      activeAmountBaseUnits: balance.activeAmountBaseUnits,
      frozenAmountBaseUnits: balance.frozenAmountBaseUnits,
      activeTokenAccountCount: balance.activeTokenAccountCount,
      frozenTokenAccountCount: balance.frozenTokenAccountCount,
      sourceSlot,
    });
  }
}
