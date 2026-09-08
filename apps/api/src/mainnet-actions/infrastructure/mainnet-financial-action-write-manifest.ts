import { isProxy } from 'node:util/types';

import { PublicKey } from '@solana/web3.js';
import { keccak256, stringToHex } from 'viem';

import type { DormantMainnetFinancialActionIntentV1 } from '../domain/dormant-mainnet-financial-action';
import {
  isCanonicalSha256,
  sha256Framed,
} from '../domain/mainnet-financial-action-signed-verification-digest';
import type { VerifiedEthereumMainnetSignedTransaction } from '../domain/ethereum-mainnet-signed-transaction.verifier';
import type {
  VerifiedSolanaInstruction,
  VerifiedSolanaMainnetSignedTransaction,
} from './solana-mainnet-signed-transaction.verifier';

export const DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFEST_SCHEMA_VERSION = 1 as const;

type IntentAddressBinding = 'INTENT_WALLET_ADDRESS' | 'INTENT_ASSET_IDENTITY' | 'INTENT_MARKET_ID';
type IntentUnsignedIntegerBinding = 'INTENT_AMOUNT_ATOMIC' | 'INTENT_ALLOWANCE_AMOUNT_ATOMIC';

export type EthereumWriteManifestArgument =
  | Readonly<{
      encoding: 'ADDRESS';
      source: IntentAddressBinding;
    }>
  | Readonly<{
      encoding: 'ADDRESS';
      source: 'STATIC';
      value: string;
    }>
  | Readonly<{
      encoding: 'UINT16' | 'UINT64' | 'UINT256';
      source: IntentUnsignedIntegerBinding;
    }>
  | Readonly<{
      encoding: 'UINT16' | 'UINT64' | 'UINT256';
      source: 'STATIC';
      value: string;
    }>
  | Readonly<{
      encoding: 'BYTES32';
      source: 'INTENT_MARKET_ID';
    }>
  | Readonly<{
      encoding: 'BYTES32';
      source: 'STATIC';
      value: string;
    }>
  | Readonly<{
      encoding: 'BOOL';
      source: 'STATIC';
      value: boolean;
    }>;

export type SolanaWriteManifestAccount =
  | Readonly<{
      source: IntentAddressBinding;
      isSigner: boolean;
      isWritable: boolean;
    }>
  | Readonly<{
      source: 'STATIC';
      address: string;
      isSigner: boolean;
      isWritable: boolean;
    }>;

export type SolanaWriteManifestDataSegment =
  | Readonly<{ encoding: 'STATIC_HEX'; value: string }>
  | Readonly<{
      encoding: 'U64_LE';
      source: IntentUnsignedIntegerBinding;
    }>
  | Readonly<{
      encoding: 'U64_LE';
      source: 'STATIC';
      value: string;
    }>
  | Readonly<{
      encoding: 'PUBLIC_KEY';
      source: IntentAddressBinding;
    }>
  | Readonly<{
      encoding: 'PUBLIC_KEY';
      source: 'STATIC';
      value: string;
    }>;

interface WriteManifestCommon {
  readonly schemaVersion: typeof DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFEST_SCHEMA_VERSION;
  readonly manifestId: string;
  readonly reviewedManifestFingerprintSha256: string;
  readonly providerId: DormantMainnetFinancialActionIntentV1['providerId'];
  readonly protocolId: DormantMainnetFinancialActionIntentV1['protocolId'];
  readonly marketId: string;
  readonly assetRegistryVersion: number;
  readonly assetRegistryFingerprintSha256: string;
  readonly assetSymbol: DormantMainnetFinancialActionIntentV1['assetSymbol'];
  readonly assetIdentity: string;
  readonly action: DormantMainnetFinancialActionIntentV1['action'];
}

export interface EthereumMainnetFinancialActionWriteManifestV1 extends WriteManifestCommon {
  readonly kind: 'ETHEREUM_EIP1559_ABI_CALL';
  readonly networkId: 'eip155:1';
  readonly transactionTarget: string;
  readonly functionSignature: string;
  readonly arguments: readonly EthereumWriteManifestArgument[];
}

export interface SolanaMainnetFinancialActionWriteManifestV1 extends WriteManifestCommon {
  readonly kind: 'SOLANA_STATIC_INSTRUCTION_SEQUENCE';
  readonly networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
  readonly messageVersion: 'legacy' | 0;
  readonly instructions: readonly Readonly<{
    readonly programId: string;
    readonly accounts: readonly SolanaWriteManifestAccount[];
    readonly data: readonly SolanaWriteManifestDataSegment[];
  }>[];
}

export type MainnetFinancialActionWriteManifestV1 =
  EthereumMainnetFinancialActionWriteManifestV1 | SolanaMainnetFinancialActionWriteManifestV1;

export type MainnetFinancialActionWriteManifestDraftV1 =
  | Omit<EthereumMainnetFinancialActionWriteManifestV1, 'reviewedManifestFingerprintSha256'>
  | Omit<SolanaMainnetFinancialActionWriteManifestV1, 'reviewedManifestFingerprintSha256'>;

export type VerifiedMainnetFinancialActionSignedCommand =
  VerifiedEthereumMainnetSignedTransaction | VerifiedSolanaMainnetSignedTransaction;

export type MainnetFinancialActionWriteManifestMatchCode =
  'INVALID_WRITE_MANIFEST' | 'WRITE_MANIFEST_UNAVAILABLE' | 'SIGNED_COMMAND_MISMATCH';

export class MainnetFinancialActionWriteManifestMatchError extends Error {
  constructor(readonly code: MainnetFinancialActionWriteManifestMatchCode) {
    super(code);
    this.name = 'MainnetFinancialActionWriteManifestMatchError';
  }
}

export interface MainnetFinancialActionWriteManifestMatch {
  readonly providerWriteManifestFingerprintSha256: string;
  readonly providerActionBindingSha256: string;
}

/** No provider has approved write semantics; the production registry is intentionally all-deny. */
export const DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFESTS: readonly MainnetFinancialActionWriteManifestV1[] =
  Object.freeze([]);

const MANIFEST_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const LOWERCASE_HEX_BYTES = /^(?:[0-9a-f]{2})*$/u;
const LOWERCASE_BYTES32 = /^0x[0-9a-f]{64}$/u;
const LOWERCASE_EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;
const CANONICAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
const ETHEREUM_ARGUMENT_TYPES = Object.freeze({
  ADDRESS: 'address',
  UINT16: 'uint16',
  UINT64: 'uint64',
  UINT256: 'uint256',
  BYTES32: 'bytes32',
  BOOL: 'bool',
} as const);

function invalidManifest(): never {
  throw new MainnetFinancialActionWriteManifestMatchError('INVALID_WRITE_MANIFEST');
}

function mismatch(): never {
  throw new MainnetFinancialActionWriteManifestMatchError('SIGNED_COMMAND_MISMATCH');
}

function assertPlainDataGraph(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== 'object' || value === null) return;
  if (isProxy(value) || seen.has(value)) return invalidManifest();
  const prototype = Object.getPrototypeOf(value);
  const prototypeParent = prototype === null ? null : Object.getPrototypeOf(prototype);
  const prototypeGrandparent =
    prototypeParent === null ? null : Object.getPrototypeOf(prototypeParent);
  const plainRecord = !Array.isArray(value) && (prototype === null || prototypeParent === null);
  const plainArray =
    Array.isArray(value) &&
    prototype !== null &&
    prototypeParent !== null &&
    prototypeGrandparent === null;
  if (!plainRecord && !plainArray) {
    return invalidManifest();
  }
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      return invalidManifest();
    }
    assertPlainDataGraph(descriptor.value, seen);
  }
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  const prototype =
    typeof value === 'object' && value !== null ? Object.getPrototypeOf(value) : undefined;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    isProxy(value) ||
    (prototype !== null &&
      (typeof prototype !== 'object' ||
        prototype === null ||
        Object.getPrototypeOf(prototype) !== null))
  ) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function canonicalUnsignedInteger(value: unknown, bits: 16 | 64 | 256): string {
  if (typeof value !== 'string' || !CANONICAL_UINT.test(value)) return invalidManifest();
  try {
    const parsed = BigInt(value);
    if (parsed >= 1n << BigInt(bits)) return invalidManifest();
    return value;
  } catch {
    return invalidManifest();
  }
}

function canonicalEvmAddress(value: unknown): string {
  if (typeof value !== 'string' || !LOWERCASE_EVM_ADDRESS.test(value)) return invalidManifest();
  return value;
}

function canonicalSolanaAddress(value: unknown): string {
  if (typeof value !== 'string') return invalidManifest();
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) return invalidManifest();
    return value;
  } catch {
    return invalidManifest();
  }
}

function unsignedIntegerFromIntent(
  intent: DormantMainnetFinancialActionIntentV1,
  source: IntentUnsignedIntegerBinding,
): string {
  return source === 'INTENT_AMOUNT_ATOMIC' ? intent.amountAtomic : intent.allowanceAmountAtomic;
}

function addressFromIntent(
  intent: DormantMainnetFinancialActionIntentV1,
  source: IntentAddressBinding,
): string {
  if (source === 'INTENT_WALLET_ADDRESS') return intent.walletAddress;
  if (source === 'INTENT_ASSET_IDENTITY') return intent.assetIdentity;
  return intent.marketId;
}

function validateCommon(manifest: Record<string, unknown>, hasFingerprint: boolean): void {
  if (
    manifest.schemaVersion !== DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFEST_SCHEMA_VERSION ||
    typeof manifest.manifestId !== 'string' ||
    !MANIFEST_ID.test(manifest.manifestId) ||
    typeof manifest.providerId !== 'string' ||
    typeof manifest.protocolId !== 'string' ||
    typeof manifest.marketId !== 'string' ||
    !Number.isSafeInteger(manifest.assetRegistryVersion) ||
    (manifest.assetRegistryVersion as number) <= 0 ||
    !isCanonicalSha256(manifest.assetRegistryFingerprintSha256) ||
    typeof manifest.assetSymbol !== 'string' ||
    typeof manifest.assetIdentity !== 'string' ||
    typeof manifest.action !== 'string' ||
    (hasFingerprint && !isCanonicalSha256(manifest.reviewedManifestFingerprintSha256))
  ) {
    return invalidManifest();
  }
}

function validateEthereumArgument(argument: unknown): void {
  if (typeof argument !== 'object' || argument === null || isProxy(argument))
    return invalidManifest();
  const candidate = argument as Record<string, unknown>;
  const isStatic = candidate.source === 'STATIC';
  if (!exactKeys(candidate, isStatic ? ['encoding', 'source', 'value'] : ['encoding', 'source'])) {
    return invalidManifest();
  }
  if (typeof candidate.encoding !== 'string' || !(candidate.encoding in ETHEREUM_ARGUMENT_TYPES))
    return invalidManifest();
  if (candidate.encoding === 'ADDRESS') {
    if (isStatic) canonicalEvmAddress(candidate.value);
    else if (
      !['INTENT_WALLET_ADDRESS', 'INTENT_ASSET_IDENTITY', 'INTENT_MARKET_ID'].includes(
        String(candidate.source),
      )
    )
      return invalidManifest();
    return;
  }
  if (
    candidate.encoding === 'UINT16' ||
    candidate.encoding === 'UINT64' ||
    candidate.encoding === 'UINT256'
  ) {
    if (isStatic)
      canonicalUnsignedInteger(
        candidate.value,
        Number(String(candidate.encoding).slice(4)) as 16 | 64 | 256,
      );
    else if (
      !['INTENT_AMOUNT_ATOMIC', 'INTENT_ALLOWANCE_AMOUNT_ATOMIC'].includes(String(candidate.source))
    )
      return invalidManifest();
    return;
  }
  if (candidate.encoding === 'BYTES32') {
    if (isStatic) {
      if (typeof candidate.value !== 'string' || !LOWERCASE_BYTES32.test(candidate.value))
        return invalidManifest();
    } else if (candidate.source !== 'INTENT_MARKET_ID') return invalidManifest();
    return;
  }
  if (candidate.encoding !== 'BOOL' || !isStatic || typeof candidate.value !== 'boolean') {
    return invalidManifest();
  }
}

function validateSolanaAccount(account: unknown): void {
  if (typeof account !== 'object' || account === null || isProxy(account)) return invalidManifest();
  const candidate = account as Record<string, unknown>;
  const isStatic = candidate.source === 'STATIC';
  if (
    !exactKeys(
      candidate,
      isStatic
        ? ['source', 'address', 'isSigner', 'isWritable']
        : ['source', 'isSigner', 'isWritable'],
    )
  )
    return invalidManifest();
  if (typeof candidate.isSigner !== 'boolean' || typeof candidate.isWritable !== 'boolean')
    return invalidManifest();
  if (isStatic) canonicalSolanaAddress(candidate.address);
  else if (
    !['INTENT_WALLET_ADDRESS', 'INTENT_ASSET_IDENTITY', 'INTENT_MARKET_ID'].includes(
      String(candidate.source),
    )
  )
    return invalidManifest();
}

function validateSolanaDataSegment(segment: unknown): void {
  if (typeof segment !== 'object' || segment === null || isProxy(segment)) return invalidManifest();
  const candidate = segment as Record<string, unknown>;
  if (candidate.encoding === 'STATIC_HEX') {
    if (
      !exactKeys(candidate, ['encoding', 'value']) ||
      typeof candidate.value !== 'string' ||
      !LOWERCASE_HEX_BYTES.test(candidate.value)
    )
      return invalidManifest();
    return;
  }
  const isStatic = candidate.source === 'STATIC';
  if (!exactKeys(candidate, isStatic ? ['encoding', 'source', 'value'] : ['encoding', 'source']))
    return invalidManifest();
  if (candidate.encoding === 'U64_LE') {
    if (isStatic) canonicalUnsignedInteger(candidate.value, 64);
    else if (
      !['INTENT_AMOUNT_ATOMIC', 'INTENT_ALLOWANCE_AMOUNT_ATOMIC'].includes(String(candidate.source))
    )
      return invalidManifest();
    return;
  }
  if (candidate.encoding === 'PUBLIC_KEY') {
    if (isStatic) canonicalSolanaAddress(candidate.value);
    else if (
      !['INTENT_WALLET_ADDRESS', 'INTENT_ASSET_IDENTITY', 'INTENT_MARKET_ID'].includes(
        String(candidate.source),
      )
    )
      return invalidManifest();
    return;
  }
  return invalidManifest();
}

function normalizedEthereumArgument(
  argument: EthereumWriteManifestArgument,
): Record<string, unknown> {
  validateEthereumArgument(argument);
  if (argument.source === 'STATIC') {
    return { encoding: argument.encoding, source: argument.source, value: argument.value };
  }
  return { encoding: argument.encoding, source: argument.source };
}

function normalizedSolanaAccount(account: SolanaWriteManifestAccount): Record<string, unknown> {
  validateSolanaAccount(account);
  if (account.source === 'STATIC') {
    return {
      source: account.source,
      address: account.address,
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    };
  }
  return { source: account.source, isSigner: account.isSigner, isWritable: account.isWritable };
}

function normalizedSolanaDataSegment(
  segment: SolanaWriteManifestDataSegment,
): Record<string, unknown> {
  validateSolanaDataSegment(segment);
  if (segment.encoding === 'STATIC_HEX') {
    return { encoding: segment.encoding, value: segment.value };
  }
  if (segment.source === 'STATIC') {
    return { encoding: segment.encoding, source: segment.source, value: segment.value };
  }
  return { encoding: segment.encoding, source: segment.source };
}

function normalizedManifest(
  candidate: MainnetFinancialActionWriteManifestV1 | MainnetFinancialActionWriteManifestDraftV1,
  hasFingerprint: boolean,
): Record<string, unknown> {
  const commonKeys = [
    'schemaVersion',
    'manifestId',
    ...(hasFingerprint ? ['reviewedManifestFingerprintSha256'] : []),
    'kind',
    'networkId',
    'providerId',
    'protocolId',
    'marketId',
    'assetRegistryVersion',
    'assetRegistryFingerprintSha256',
    'assetSymbol',
    'assetIdentity',
    'action',
  ];
  if (typeof candidate !== 'object' || candidate === null || isProxy(candidate))
    return invalidManifest();
  assertPlainDataGraph(candidate);
  const value = candidate as unknown as Record<string, unknown>;
  validateCommon(value, hasFingerprint);

  if (value.kind === 'ETHEREUM_EIP1559_ABI_CALL') {
    if (!exactKeys(value, [...commonKeys, 'transactionTarget', 'functionSignature', 'arguments']))
      return invalidManifest();
    if (value.networkId !== 'eip155:1') return invalidManifest();
    canonicalEvmAddress(value.marketId);
    canonicalEvmAddress(value.assetIdentity);
    canonicalEvmAddress(value.transactionTarget);
    if (!Array.isArray(value.arguments) || isProxy(value.arguments) || value.arguments.length > 32)
      return invalidManifest();
    for (const argument of value.arguments) validateEthereumArgument(argument);
    const types = value.arguments.map(
      (argument) => ETHEREUM_ARGUMENT_TYPES[(argument as EthereumWriteManifestArgument).encoding],
    );
    if (
      typeof value.functionSignature !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*\([a-z0-9,]*\)$/u.test(value.functionSignature) ||
      value.functionSignature.slice(value.functionSignature.indexOf('(') + 1, -1) !==
        types.join(',')
    )
      return invalidManifest();
    return {
      schemaVersion: value.schemaVersion,
      manifestId: value.manifestId,
      kind: value.kind,
      networkId: value.networkId,
      providerId: value.providerId,
      protocolId: value.protocolId,
      marketId: value.marketId,
      assetRegistryVersion: value.assetRegistryVersion,
      assetRegistryFingerprintSha256: value.assetRegistryFingerprintSha256,
      assetSymbol: value.assetSymbol,
      assetIdentity: value.assetIdentity,
      action: value.action,
      transactionTarget: value.transactionTarget,
      functionSignature: value.functionSignature,
      arguments: value.arguments.map((argument) =>
        normalizedEthereumArgument(argument as EthereumWriteManifestArgument),
      ),
    };
  }

  if (value.kind === 'SOLANA_STATIC_INSTRUCTION_SEQUENCE') {
    if (!exactKeys(value, [...commonKeys, 'messageVersion', 'instructions']))
      return invalidManifest();
    if (
      value.networkId !== 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' ||
      (value.messageVersion !== 'legacy' && value.messageVersion !== 0) ||
      !Array.isArray(value.instructions) ||
      isProxy(value.instructions) ||
      value.instructions.length === 0 ||
      value.instructions.length > 64
    )
      return invalidManifest();
    canonicalSolanaAddress(value.marketId);
    canonicalSolanaAddress(value.assetIdentity);
    for (const instruction of value.instructions) {
      if (!exactKeys(instruction, ['programId', 'accounts', 'data'])) return invalidManifest();
      canonicalSolanaAddress(instruction.programId);
      if (
        !Array.isArray(instruction.accounts) ||
        isProxy(instruction.accounts) ||
        instruction.accounts.length > 64
      )
        return invalidManifest();
      if (
        !Array.isArray(instruction.data) ||
        isProxy(instruction.data) ||
        instruction.data.length > 64
      )
        return invalidManifest();
      for (const account of instruction.accounts) validateSolanaAccount(account);
      for (const segment of instruction.data) validateSolanaDataSegment(segment);
    }
    return {
      schemaVersion: value.schemaVersion,
      manifestId: value.manifestId,
      kind: value.kind,
      networkId: value.networkId,
      providerId: value.providerId,
      protocolId: value.protocolId,
      marketId: value.marketId,
      assetRegistryVersion: value.assetRegistryVersion,
      assetRegistryFingerprintSha256: value.assetRegistryFingerprintSha256,
      assetSymbol: value.assetSymbol,
      assetIdentity: value.assetIdentity,
      action: value.action,
      messageVersion: value.messageVersion,
      instructions: value.instructions.map((instruction) => ({
        programId: instruction.programId,
        accounts: instruction.accounts.map((account: unknown) =>
          normalizedSolanaAccount(account as SolanaWriteManifestAccount),
        ),
        data: instruction.data.map((segment: unknown) =>
          normalizedSolanaDataSegment(segment as SolanaWriteManifestDataSegment),
        ),
      })),
    };
  }
  return invalidManifest();
}

export function fingerprintMainnetFinancialActionWriteManifest(
  manifest: MainnetFinancialActionWriteManifestDraftV1,
): string {
  const normalized = normalizedManifest(manifest, false);
  return sha256Framed('CLMA-PROVIDER-WRITE-MANIFEST-1', [JSON.stringify(normalized)]);
}

function assertReviewedFingerprint(manifest: MainnetFinancialActionWriteManifestV1): void {
  const { reviewedManifestFingerprintSha256: _fingerprint, ...draft } = manifest;
  void _fingerprint;
  const calculated = fingerprintMainnetFinancialActionWriteManifest(draft);
  if (calculated !== manifest.reviewedManifestFingerprintSha256) return invalidManifest();
}

function uint256Word(value: string, bits: 16 | 64 | 256): string {
  const parsed = BigInt(canonicalUnsignedInteger(value, bits));
  return parsed.toString(16).padStart(64, '0');
}

function ethereumArgumentWord(
  argument: EthereumWriteManifestArgument,
  intent: DormantMainnetFinancialActionIntentV1,
): string {
  if (argument.encoding === 'ADDRESS') {
    const value =
      argument.source === 'STATIC' ? argument.value : addressFromIntent(intent, argument.source);
    return canonicalEvmAddress(value).slice(2).padStart(64, '0');
  }
  if (argument.encoding === 'BYTES32') {
    const value = argument.source === 'STATIC' ? argument.value : intent.marketId;
    if (!LOWERCASE_BYTES32.test(value)) return mismatch();
    return value.slice(2);
  }
  if (argument.encoding === 'BOOL') return argument.value ? '0'.repeat(63) + '1' : '0'.repeat(64);
  const value =
    argument.source === 'STATIC'
      ? argument.value
      : unsignedIntegerFromIntent(intent, argument.source);
  return uint256Word(value, Number(argument.encoding.slice(4)) as 16 | 64 | 256);
}

function expectedEthereumCalldata(
  manifest: EthereumMainnetFinancialActionWriteManifestV1,
  intent: DormantMainnetFinancialActionIntentV1,
): string {
  const selector = keccak256(stringToHex(manifest.functionSignature)).slice(2, 10);
  return `0x${selector}${manifest.arguments.map((argument) => ethereumArgumentWord(argument, intent)).join('')}`;
}

function littleEndianU64(value: string): Buffer {
  let remaining = BigInt(canonicalUnsignedInteger(value, 64));
  const bytes = Buffer.alloc(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function expectedSolanaData(
  segments: readonly SolanaWriteManifestDataSegment[],
  intent: DormantMainnetFinancialActionIntentV1,
): string {
  const chunks = segments.map((segment) => {
    if (segment.encoding === 'STATIC_HEX') return Buffer.from(segment.value, 'hex');
    if (segment.encoding === 'U64_LE') {
      return littleEndianU64(
        segment.source === 'STATIC'
          ? segment.value
          : unsignedIntegerFromIntent(intent, segment.source),
      );
    }
    const address =
      segment.source === 'STATIC' ? segment.value : addressFromIntent(intent, segment.source);
    return Buffer.from(new PublicKey(canonicalSolanaAddress(address)).toBytes());
  });
  return Buffer.concat(chunks).toString('hex');
}

function accountMatches(
  actual: VerifiedSolanaInstruction['accounts'][number],
  expected: SolanaWriteManifestAccount,
  intent: DormantMainnetFinancialActionIntentV1,
): boolean {
  const expectedAddress =
    expected.source === 'STATIC' ? expected.address : addressFromIntent(intent, expected.source);
  return (
    actual.address === expectedAddress &&
    actual.isSigner === expected.isSigner &&
    actual.isWritable === expected.isWritable
  );
}

function commonMatches(
  manifest: MainnetFinancialActionWriteManifestV1,
  intent: DormantMainnetFinancialActionIntentV1,
): boolean {
  return (
    manifest.networkId === intent.networkId &&
    manifest.providerId === intent.providerId &&
    manifest.protocolId === intent.protocolId &&
    manifest.marketId === intent.marketId &&
    manifest.assetRegistryVersion === intent.assetRegistryVersion &&
    manifest.assetRegistryFingerprintSha256 === intent.assetRegistryFingerprintSha256 &&
    manifest.assetSymbol === intent.assetSymbol &&
    manifest.assetIdentity === intent.assetIdentity &&
    manifest.action === intent.action
  );
}

export function fingerprintDormantMainnetSignedVerificationIntent(
  intentRecordFingerprintSha256: string,
  intent: DormantMainnetFinancialActionIntentV1,
): string {
  if (!isCanonicalSha256(intentRecordFingerprintSha256)) return invalidManifest();
  return sha256Framed('CLMA-SIGNED-VERIFICATION-INTENT-1', [
    intentRecordFingerprintSha256,
    String(intent.schemaVersion),
    intent.use,
    String(intent.mayAuthorizeFinancialAction),
    intent.intentId,
    intent.accountId,
    intent.walletRegistrationId,
    intent.replayProtectionId,
    intent.idempotencyKeyDigestSha256,
    intent.networkId,
    intent.walletAddress,
    intent.providerId,
    intent.protocolId,
    intent.marketId,
    String(intent.assetRegistryVersion),
    intent.assetRegistryFingerprintSha256,
    intent.assetSymbol,
    intent.assetIdentity,
    String(intent.assetDecimals),
    intent.action,
    intent.amountAtomic,
    intent.requestedValueUsdMicros,
    intent.maximumNetworkFeeAtomic,
    String(intent.maximumNetworkFeeBasisPoints),
    intent.minimumPostActionNativeBalanceAtomic,
    intent.allowanceMode,
    intent.allowanceAmountAtomic,
    intent.issuedAt,
    intent.expiresAt,
    intent.signingResponsibility,
    intent.broadcastResponsibility,
    String(intent.apiMaySign),
    String(intent.apiMayBroadcast),
    String(intent.crossChainExecutionAllowed),
    String(intent.automaticResendAllowed),
    String(intent.automaticFeeEscalationAllowed),
    String(intent.durableReplayProtectionVerified),
  ]);
}

export function matchMainnetFinancialActionWriteManifest(
  intentRecordFingerprintSha256: string,
  intent: DormantMainnetFinancialActionIntentV1,
  command: VerifiedMainnetFinancialActionSignedCommand,
  registry: readonly MainnetFinancialActionWriteManifestV1[] = DORMANT_MAINNET_FINANCIAL_ACTION_WRITE_MANIFESTS,
): MainnetFinancialActionWriteManifestMatch {
  if (!Array.isArray(registry) || isProxy(registry)) return invalidManifest();
  for (const manifest of registry) {
    normalizedManifest(manifest, true);
    assertReviewedFingerprint(manifest);
  }
  const candidates = registry.filter((manifest) => commonMatches(manifest, intent));
  if (candidates.length !== 1) {
    throw new MainnetFinancialActionWriteManifestMatchError(
      candidates.length === 0 ? 'WRITE_MANIFEST_UNAVAILABLE' : 'INVALID_WRITE_MANIFEST',
    );
  }
  const manifest = candidates[0];
  if (manifest === undefined || manifest.networkId !== command.networkId) return mismatch();

  if (manifest.kind === 'ETHEREUM_EIP1559_ABI_CALL') {
    if (
      command.kind !== 'VERIFIED_ETHEREUM_EIP1559_TRANSACTION' ||
      command.transactionTarget !== manifest.transactionTarget ||
      command.maximumNetworkFeeAtomic !== intent.maximumNetworkFeeAtomic ||
      command.calldata !== expectedEthereumCalldata(manifest, intent)
    )
      return mismatch();
  } else {
    if (
      command.kind !== 'VERIFIED_SOLANA_SIGNED_TRANSACTION' ||
      command.messageVersion !== manifest.messageVersion ||
      command.instructions.length !== manifest.instructions.length
    )
      return mismatch();
    for (let index = 0; index < manifest.instructions.length; index += 1) {
      const expected = manifest.instructions[index];
      const actual = command.instructions[index];
      if (
        expected === undefined ||
        actual === undefined ||
        actual.programId !== expected.programId ||
        actual.accounts.length !== expected.accounts.length ||
        actual.dataHex !== expectedSolanaData(expected.data, intent)
      )
        return mismatch();
      for (let accountIndex = 0; accountIndex < expected.accounts.length; accountIndex += 1) {
        const expectedAccount = expected.accounts[accountIndex];
        const actualAccount = actual.accounts[accountIndex];
        if (
          expectedAccount === undefined ||
          actualAccount === undefined ||
          !accountMatches(actualAccount, expectedAccount, intent)
        )
          return mismatch();
      }
    }
  }

  const verificationIntentFingerprintSha256 = fingerprintDormantMainnetSignedVerificationIntent(
    intentRecordFingerprintSha256,
    intent,
  );
  return Object.freeze({
    providerWriteManifestFingerprintSha256: manifest.reviewedManifestFingerprintSha256,
    providerActionBindingSha256: sha256Framed('CLMA-PROVIDER-ACTION-BINDING-1', [
      verificationIntentFingerprintSha256,
      manifest.reviewedManifestFingerprintSha256,
      command.transactionId,
      command.signedEnvelopeSha256,
      command.signingPayloadSha256,
      command.signatureEvidenceSha256,
      command.chainReplayIdentitySha256,
    ]),
  });
}
