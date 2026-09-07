import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

import {
  decodeSolanaPublicKey,
  SOLANA_TOKEN_PROGRAM_IDS,
} from '../../../blockchain/domain/solana-token-account';
import {
  createSolanaMainnetBalanceDeploymentIdentityVerifier,
  reviewBalanceSyncExecutionContext,
  type BalanceSyncClockPort,
  type BalanceSyncExecutionContext,
  type SolanaMainnetBalanceDeploymentIdentityVerificationRequest,
  type SolanaMainnetBalanceDeploymentIdentityVerifierPort,
} from '../../application/ports/balance-sync.ports';
import {
  SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
  reviewSolanaMainnetBalanceDeploymentManifestV1,
  type SOLANA_BPF_UPGRADEABLE_LOADER_V3,
  type SolanaMainnetBalanceDeploymentAssetV1,
  type SolanaMainnetBalanceDeploymentManifestV1,
  type SolanaMainnetBalanceDeploymentProgramV1,
} from './solana-mainnet-balance-deployment.manifest';
import {
  allowedRecord,
  exactRecord,
  exchangeBalanceRpc,
  type BalanceJsonRpcRequest,
  type BalanceJsonRpcTransport,
} from './balance-json-rpc';

const SOLANA_MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const LEGACY_MINT_BYTES = 82;
const TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165;
const TOKEN_2022_MINT_ACCOUNT_TYPE = 1;
const TOKEN_2022_TLV_OFFSET = 166;
const PROGRAM_ACCOUNT_BYTES = 36;
const PROGRAM_DATA_METADATA_BYTES = 45;
const MAX_ACCOUNT_BYTES = 2 * 1024 * 1024;
const UPGRADEABLE_LOADER_PROGRAM_DISCRIMINANT = 2;
const UPGRADEABLE_LOADER_PROGRAM_DATA_DISCRIMINANT = 3;

const BLOCK_KEYS = Object.freeze([
  'blockHeight',
  'blockTime',
  'blockhash',
  'numRewardPartitions',
  'parentSlot',
  'previousBlockhash',
  'rewards',
  'signatures',
  'transactions',
] as const);

interface CapturedDataMethod {
  readonly receiver: object;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

interface ObservedMintIdentity {
  readonly stablecoin: SolanaMainnetBalanceDeploymentAssetV1['stablecoin'];
  readonly mintAddress: string;
  readonly tokenProgramAddress: string;
  readonly decimals: 6;
  readonly mintAuthorityAddress: string | null;
  readonly freezeAuthorityAddress: string | null;
  readonly mintConfigurationSha256: string;
  readonly accountBytes: number;
}

interface ObservedProgramIdentity {
  readonly route: 'BPF_UPGRADEABLE_LOADER_V3';
  readonly programAddress: string;
  readonly loaderAddress: typeof SOLANA_BPF_UPGRADEABLE_LOADER_V3;
  readonly programDataAddress: string;
  readonly deployedAtSlot: string;
  readonly upgradeAuthorityAddress: string | null;
  readonly programBinarySha256: string;
  readonly programBinaryBytes: number;
}

interface SolanaAccountSnapshot {
  readonly owner: string;
  readonly executable: boolean;
  readonly data: Uint8Array;
}

interface SolanaBlockAnchor {
  readonly parentSlot: number;
  readonly previousBlockhash: string;
}

/**
 * Constructs a provider-neutral, dormant verifier. The manifest fingerprint
 * must be supplied independently so a self-authored manifest cannot approve
 * itself. No endpoint, credential, timer, or runtime registration is owned.
 */
export function createDormantSolanaMainnetBalanceDeploymentIdentityVerifier(
  manifestInput: unknown,
  independentlyApprovedManifestFingerprintSha256: string,
  transportInput: BalanceJsonRpcTransport,
  clockInput: BalanceSyncClockPort,
): SolanaMainnetBalanceDeploymentIdentityVerifierPort {
  const manifest = reviewSolanaMainnetBalanceDeploymentManifestV1(manifestInput);
  if (
    manifest?.approvalStatus !== 'APPROVED' ||
    typeof independentlyApprovedManifestFingerprintSha256 !== 'string' ||
    !SHA256.test(independentlyApprovedManifestFingerprintSha256) ||
    independentlyApprovedManifestFingerprintSha256 === '0'.repeat(64) ||
    independentlyApprovedManifestFingerprintSha256 !== manifest.fingerprintSha256
  ) {
    throw new TypeError('Solana deployment identity verifier unavailable');
  }
  const transportMethod = captureDataMethod(transportInput, 'exchange');
  const clockMethod = captureDataMethod(clockInput, 'now');
  const transport = Object.freeze({
    exchange: (request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown> =>
      Reflect.apply(transportMethod.method, transportMethod.receiver, [
        request,
        signal,
      ]) as Promise<unknown>,
  });
  const verify = async (
    request: Readonly<SolanaMainnetBalanceDeploymentIdentityVerificationRequest>,
    execution: BalanceSyncExecutionContext,
  ): Promise<unknown> =>
    verifyDeploymentIdentity(manifest, transport, clockMethod, request, execution);
  return createSolanaMainnetBalanceDeploymentIdentityVerifier(verify);
}

/** Standard SHA-256 over exact mint bytes with only supply bytes 36..43 zeroed. */
export function fingerprintSolanaMainnetMintConfigurationV1(dataInput: Uint8Array): string {
  const data = ownedBytes(dataInput, LEGACY_MINT_BYTES, MAX_ACCOUNT_BYTES);
  data.fill(0, 36, 44);
  return createHash('sha256').update(data).digest('hex');
}

/** Standard SHA-256 over the executable bytes after loader-v3 metadata. */
export function fingerprintSolanaMainnetProgramBinaryV1(programBinaryInput: Uint8Array): string {
  const programBinary = ownedBytes(programBinaryInput, 1, MAX_ACCOUNT_BYTES);
  return createHash('sha256').update(programBinary).digest('hex');
}

async function verifyDeploymentIdentity(
  manifest: Readonly<SolanaMainnetBalanceDeploymentManifestV1>,
  transport: BalanceJsonRpcTransport,
  clockMethod: CapturedDataMethod,
  request: Readonly<SolanaMainnetBalanceDeploymentIdentityVerificationRequest>,
  execution: BalanceSyncExecutionContext,
): Promise<unknown> {
  requireActive(execution);
  const startedAt = assertApprovalCurrent(manifest, clockMethod);
  if (
    request.networkId !== SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID ||
    request.assetIdentities.length !== manifest.assets.length ||
    request.assetIdentities.some(
      (identity, index) => identity !== manifest.assets[index]?.mintAddress,
    )
  ) {
    return fail();
  }
  const slot = parseSafeSlot(request.sourcePosition);
  if (
    BigInt(request.sourcePosition) < BigInt(manifest.validFromSlot!) ||
    BigInt(request.sourcePosition) > BigInt(manifest.validThroughSlot!) ||
    !canonicalPublicKey(request.sourceHash)
  ) {
    return fail();
  }

  await assertMainnet(transport, execution);
  const initialAnchor = await readBlockAnchor(transport, execution, slot, request.sourceHash);
  const addresses = Object.freeze([
    ...manifest.assets.map(({ mintAddress }) => mintAddress),
    ...manifest.programs.map(({ programAddress }) => programAddress),
    ...manifest.programs.map(({ programDataAddress }) => programDataAddress),
  ]);
  const snapshots = await readExactAccounts(transport, execution, addresses, slot);
  const mintSnapshots = snapshots.slice(0, manifest.assets.length);
  const programSnapshots = snapshots.slice(
    manifest.assets.length,
    manifest.assets.length + manifest.programs.length,
  );
  const programDataSnapshots = snapshots.slice(manifest.assets.length + manifest.programs.length);
  const observedMints = manifest.assets.map((asset, index) =>
    inspectMint(asset, requireSnapshot(mintSnapshots[index])),
  );
  const observedPrograms = manifest.programs.map((program, index) =>
    inspectProgram(
      program,
      requireSnapshot(programSnapshots[index]),
      requireSnapshot(programDataSnapshots[index]),
    ),
  );
  const completedAnchor = await readBlockAnchor(transport, execution, slot, request.sourceHash);
  if (
    completedAnchor.parentSlot !== initialAnchor.parentSlot ||
    completedAnchor.previousBlockhash !== initialAnchor.previousBlockhash
  ) {
    return fail();
  }
  await assertMainnet(transport, execution);
  requireActive(execution);
  const completedAt = assertApprovalCurrent(manifest, clockMethod);
  if (completedAt < startedAt) return fail();

  return Object.freeze({
    deploymentIdentityValidated: true as const,
    approvedManifestFingerprintSha256: manifest.fingerprintSha256,
    observedIdentityFingerprintSha256: fingerprintObservedIdentity(
      request,
      observedMints,
      observedPrograms,
    ),
  });
}

async function assertMainnet(
  transport: BalanceJsonRpcTransport,
  execution: BalanceSyncExecutionContext,
): Promise<void> {
  requireActive(execution);
  const genesisHash = await exchangeBalanceRpc(transport, 'getGenesisHash', [], execution);
  if (genesisHash !== SOLANA_MAINNET_GENESIS_HASH) return fail();
}

async function readBlockAnchor(
  transport: BalanceJsonRpcTransport,
  execution: BalanceSyncExecutionContext,
  slot: number,
  sourceHash: string,
): Promise<Readonly<SolanaBlockAnchor>> {
  const result = await exchangeBalanceRpc(
    transport,
    'getBlock',
    [slot, Object.freeze({ commitment: 'finalized', transactionDetails: 'none', rewards: false })],
    execution,
  );
  const block = allowedRecord(result, ['blockhash', 'parentSlot', 'previousBlockhash'], BLOCK_KEYS);
  if (
    block.blockhash !== sourceHash ||
    !canonicalPublicKey(block.blockhash) ||
    !canonicalPublicKey(block.previousBlockhash) ||
    block.previousBlockhash === block.blockhash ||
    typeof block.parentSlot !== 'number' ||
    !Number.isSafeInteger(block.parentSlot) ||
    block.parentSlot < 0 ||
    block.parentSlot >= slot ||
    ('blockHeight' in block &&
      block.blockHeight !== null &&
      !nonnegativeInteger(block.blockHeight)) ||
    ('blockTime' in block && block.blockTime !== null && !integer(block.blockTime)) ||
    ('numRewardPartitions' in block &&
      block.numRewardPartitions !== null &&
      !nonnegativeInteger(block.numRewardPartitions)) ||
    ('rewards' in block && (!Array.isArray(block.rewards) || block.rewards.length !== 0)) ||
    ('signatures' in block &&
      (!Array.isArray(block.signatures) || block.signatures.length !== 0)) ||
    ('transactions' in block &&
      (!Array.isArray(block.transactions) || block.transactions.length !== 0))
  ) {
    return fail();
  }
  return Object.freeze({
    parentSlot: block.parentSlot,
    previousBlockhash: block.previousBlockhash,
  });
}

async function readExactAccounts(
  transport: BalanceJsonRpcTransport,
  execution: BalanceSyncExecutionContext,
  addresses: readonly string[],
  slot: number,
): Promise<readonly SolanaAccountSnapshot[]> {
  const result = await exchangeBalanceRpc(
    transport,
    'getMultipleAccounts',
    [
      addresses,
      Object.freeze({ commitment: 'finalized', encoding: 'base64', minContextSlot: slot }),
    ],
    execution,
  );
  const response = exactRecord(result, ['context', 'value']);
  const context = allowedRecord(response.context, ['slot'], ['apiVersion', 'slot']);
  if (
    context.slot !== slot ||
    ('apiVersion' in context &&
      (typeof context.apiVersion !== 'string' || context.apiVersion.length > 64)) ||
    !Array.isArray(response.value) ||
    response.value.length !== addresses.length
  ) {
    return fail();
  }
  return Object.freeze(
    response.value.map((value) => {
      if (value === null) return fail();
      const account = exactRecord(value, [
        'data',
        'executable',
        'lamports',
        'owner',
        'rentEpoch',
        'space',
      ]);
      const data = parseBase64(account.data);
      if (
        typeof account.executable !== 'boolean' ||
        !canonicalPublicKey(account.owner) ||
        !nonnegativeInteger(account.lamports) ||
        !nonnegativeInteger(account.rentEpoch) ||
        typeof account.space !== 'number' ||
        !Number.isSafeInteger(account.space) ||
        account.space !== data.byteLength
      ) {
        return fail();
      }
      return Object.freeze({ owner: account.owner, executable: account.executable, data });
    }),
  );
}

function inspectMint(
  manifest: Readonly<SolanaMainnetBalanceDeploymentAssetV1>,
  account: Readonly<SolanaAccountSnapshot>,
): Readonly<ObservedMintIdentity> {
  const token2022 = manifest.tokenProgramAddress === SOLANA_TOKEN_PROGRAM_IDS.TOKEN_2022;
  if (
    account.owner !== manifest.tokenProgramAddress ||
    account.executable ||
    (token2022
      ? !validToken2022MintLayout(account.data)
      : account.data.byteLength !== LEGACY_MINT_BYTES) ||
    account.data[44] !== manifest.decimals ||
    account.data[45] !== 1 ||
    !matchesCOptionPublicKey(account.data, 0, 4, manifest.mintAuthorityAddress) ||
    !matchesCOptionPublicKey(account.data, 46, 50, manifest.freezeAuthorityAddress)
  ) {
    return fail();
  }
  const fingerprint = fingerprintSolanaMainnetMintConfigurationV1(account.data);
  if (fingerprint !== manifest.mintConfigurationSha256) return fail();
  return Object.freeze({
    stablecoin: manifest.stablecoin,
    mintAddress: manifest.mintAddress,
    tokenProgramAddress: manifest.tokenProgramAddress,
    decimals: manifest.decimals,
    mintAuthorityAddress: manifest.mintAuthorityAddress,
    freezeAuthorityAddress: manifest.freezeAuthorityAddress,
    mintConfigurationSha256: fingerprint,
    accountBytes: account.data.byteLength,
  });
}

function inspectProgram(
  manifest: Readonly<SolanaMainnetBalanceDeploymentProgramV1>,
  programAccount: Readonly<SolanaAccountSnapshot>,
  programDataAccount: Readonly<SolanaAccountSnapshot>,
): Readonly<ObservedProgramIdentity> {
  if (
    programAccount.owner !== manifest.loaderAddress ||
    !programAccount.executable ||
    programAccount.data.byteLength !== PROGRAM_ACCOUNT_BYTES ||
    uint32(programAccount.data, 0) !== UPGRADEABLE_LOADER_PROGRAM_DISCRIMINANT ||
    !samePublicKeyBytes(programAccount.data.subarray(4, 36), manifest.programDataAddress) ||
    programDataAccount.owner !== manifest.loaderAddress ||
    programDataAccount.executable ||
    programDataAccount.data.byteLength <= PROGRAM_DATA_METADATA_BYTES ||
    uint32(programDataAccount.data, 0) !== UPGRADEABLE_LOADER_PROGRAM_DATA_DISCRIMINANT ||
    uint64(programDataAccount.data, 4).toString(10) !== manifest.deployedAtSlot ||
    !matchesBincodeOptionPublicKey(
      programDataAccount.data,
      12,
      13,
      manifest.upgradeAuthorityAddress,
    )
  ) {
    return fail();
  }
  const binary = programDataAccount.data.subarray(PROGRAM_DATA_METADATA_BYTES);
  if (
    binary.byteLength < 4 ||
    binary[0] !== 0x7f ||
    binary[1] !== 0x45 ||
    binary[2] !== 0x4c ||
    binary[3] !== 0x46
  ) {
    return fail();
  }
  const binaryFingerprint = fingerprintSolanaMainnetProgramBinaryV1(binary);
  if (binaryFingerprint !== manifest.programBinarySha256) return fail();
  return Object.freeze({
    route: 'BPF_UPGRADEABLE_LOADER_V3',
    programAddress: manifest.programAddress,
    loaderAddress: manifest.loaderAddress,
    programDataAddress: manifest.programDataAddress,
    deployedAtSlot: manifest.deployedAtSlot,
    upgradeAuthorityAddress: manifest.upgradeAuthorityAddress,
    programBinarySha256: binaryFingerprint,
    programBinaryBytes: binary.byteLength,
  });
}

function validToken2022MintLayout(data: Uint8Array): boolean {
  if (data.byteLength === LEGACY_MINT_BYTES) return true;
  if (
    data.byteLength < TOKEN_2022_TLV_OFFSET ||
    data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] !== TOKEN_2022_MINT_ACCOUNT_TYPE ||
    !data.subarray(LEGACY_MINT_BYTES, TOKEN_2022_ACCOUNT_TYPE_OFFSET).every((byte) => byte === 0)
  ) {
    return false;
  }
  const types = new Set<number>();
  let offset = TOKEN_2022_TLV_OFFSET;
  while (offset < data.byteLength) {
    if (data.byteLength - offset < 4) return false;
    const type = uint16(data, offset);
    const length = uint16(data, offset + 2);
    if (type === 0 && length === 0) {
      return data.subarray(offset).every((byte) => byte === 0);
    }
    if (type === 0 || types.has(type) || offset + 4 + length > data.byteLength) return false;
    types.add(type);
    offset += 4 + length;
  }
  return offset === data.byteLength;
}

function matchesCOptionPublicKey(
  data: Uint8Array,
  discriminatorOffset: number,
  keyOffset: number,
  expected: string | null,
): boolean {
  const discriminator = uint32(data, discriminatorOffset);
  if (expected === null) {
    return (
      discriminator === 0 && data.subarray(keyOffset, keyOffset + 32).every((byte) => byte === 0)
    );
  }
  return (
    discriminator === 1 && samePublicKeyBytes(data.subarray(keyOffset, keyOffset + 32), expected)
  );
}

function matchesBincodeOptionPublicKey(
  data: Uint8Array,
  discriminatorOffset: number,
  keyOffset: number,
  expected: string | null,
): boolean {
  const discriminator = data[discriminatorOffset];
  if (expected === null) return discriminator === 0;
  return (
    discriminator === 1 && samePublicKeyBytes(data.subarray(keyOffset, keyOffset + 32), expected)
  );
}

function samePublicKeyBytes(actual: Uint8Array, expected: string): boolean {
  let expectedBytes: Uint8Array;
  try {
    expectedBytes = decodeSolanaPublicKey(expected);
  } catch {
    return false;
  }
  return (
    actual.byteLength === expectedBytes.byteLength &&
    actual.every((byte, index) => byte === expectedBytes[index])
  );
}

function parseBase64(value: unknown): Uint8Array {
  if (!Array.isArray(value) || value.length !== 2) return fail();
  const [encoded, encoding] = value as readonly unknown[];
  if (
    typeof encoded !== 'string' ||
    encoding !== 'base64' ||
    encoded.length < 1 ||
    encoded.length > Math.ceil(MAX_ACCOUNT_BYTES / 3) * 4 ||
    !CANONICAL_BASE64.test(encoded)
  ) {
    return fail();
  }
  const decoded = Buffer.from(encoded, 'base64');
  if (
    decoded.byteLength < 1 ||
    decoded.byteLength > MAX_ACCOUNT_BYTES ||
    decoded.toString('base64') !== encoded
  ) {
    return fail();
  }
  return Uint8Array.from(decoded);
}

function fingerprintObservedIdentity(
  request: Readonly<SolanaMainnetBalanceDeploymentIdentityVerificationRequest>,
  mints: readonly Readonly<ObservedMintIdentity>[],
  programs: readonly Readonly<ObservedProgramIdentity>[],
): string {
  return createHash('sha256')
    .update(
      canonicalJson([
        'crypto-lending:solana-mainnet-balance-observed-deployment-identity:v1',
        request.networkId,
        request.sourcePosition,
        request.sourceHash,
        mints,
        programs,
      ]),
      'utf8',
    )
    .digest('hex');
}

function assertApprovalCurrent(
  manifest: Readonly<SolanaMainnetBalanceDeploymentManifestV1>,
  clockMethod: CapturedDataMethod,
): number {
  let now: unknown;
  try {
    now = Reflect.apply(clockMethod.method, clockMethod.receiver, []);
  } catch {
    return fail();
  }
  if (
    typeof now !== 'object' ||
    now === null ||
    isProxy(now) ||
    Object.getPrototypeOf(now) !== Date.prototype
  ) {
    return fail();
  }
  const milliseconds = Date.prototype.getTime.call(now) as number;
  const approvedAt = Date.parse(manifest.approvedAt!);
  const expiresAt = Date.parse(manifest.expiresAt!);
  if (!Number.isFinite(milliseconds) || milliseconds < approvedAt || milliseconds >= expiresAt) {
    return fail();
  }
  return milliseconds;
}

function captureDataMethod(value: unknown, methodName: string): CapturedDataMethod {
  try {
    if (typeof value !== 'object' || value === null || isProxy(value)) return fail();
    let owner: object | null = value;
    for (let depth = 0; owner !== null && owner !== Object.prototype && depth < 8; depth += 1) {
      if (isProxy(owner)) return fail();
      const descriptor = Object.getOwnPropertyDescriptor(owner, methodName);
      if (descriptor !== undefined) {
        if (
          !('value' in descriptor) ||
          typeof descriptor.value !== 'function' ||
          isProxy(descriptor.value)
        ) {
          return fail();
        }
        return Object.freeze({ receiver: value, method: descriptor.value });
      }
      owner = Object.getPrototypeOf(owner) as object | null;
    }
  } catch {
    // Fall through to the same fail-closed error.
  }
  return fail();
}

function requireActive(execution: unknown): void {
  if (reviewBalanceSyncExecutionContext(execution)?.abortKind !== null) return fail();
}

function parseSafeSlot(value: string): number {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    return fail();
  }
  if (parsed < 1n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
  return Number(parsed);
}

function requireSnapshot(value: SolanaAccountSnapshot | undefined): SolanaAccountSnapshot {
  return value ?? fail();
}

function canonicalPublicKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    decodeSolanaPublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function ownedBytes(value: unknown, minimum: number, maximum: number): Uint8Array {
  if (
    !ArrayBuffer.isView(value) ||
    !(value instanceof Uint8Array) ||
    value.byteLength < minimum ||
    value.byteLength > maximum
  ) {
    return fail();
  }
  return Uint8Array.from(value);
}

function uint16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(offset, true);
}

function uint32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function uint64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function nonnegativeInteger(value: unknown): value is number {
  return integer(value) && value >= 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compare)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(): never {
  throw new TypeError('Solana deployment identity verification unavailable');
}
