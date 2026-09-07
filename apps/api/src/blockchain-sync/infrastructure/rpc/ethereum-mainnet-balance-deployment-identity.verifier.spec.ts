import { createHash } from 'node:crypto';

import {
  attestEthereumMainnetBalanceDeploymentIdentity,
  createBalanceSyncExecutionContext,
  reviewMainnetBalanceDeploymentIdentityAttestation,
  type BalanceSyncExecutionContextOwner,
  type EthereumMainnetBalanceDeploymentIdentityVerificationRequest,
  type EthereumMainnetBalanceDeploymentIdentityVerifierPort,
} from '../../application/ports/balance-sync.ports';
import type { BalanceJsonRpcRequest, BalanceJsonRpcTransport } from './balance-json-rpc';
import {
  ETHEREUM_MAINNET_BALANCE_ASSETS,
  ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES,
  ethereumMainnetBalanceDeploymentManifestFingerprintSha256,
} from './ethereum-mainnet-balance-deployment.manifest';
import {
  EIP1967_ADMIN_SLOT,
  EIP1967_BEACON_SLOT,
  EIP1967_IMPLEMENTATION_SLOT,
  LEGACY_ZEPPELIN_ADMIN_SLOT,
  LEGACY_ZEPPELIN_IMPLEMENTATION_SLOT,
  createDormantEthereumMainnetBalanceDeploymentIdentityVerifier,
} from './ethereum-mainnet-balance-deployment-identity.verifier';

const POSITION = '20000000';
const BLOCK_NUMBER = '0x1312d00';
const BLOCK_HASH = `0x${'a'.repeat(64)}`;
const ZERO_WORD = `0x${'0'.repeat(64)}`;
const PYUSD = ETHEREUM_MAINNET_BALANCE_ASSETS[0]!.address;
const USDC = ETHEREUM_MAINNET_BALANCE_ASSETS[1]!.address;
const USDT = ETHEREUM_MAINNET_BALANCE_ASSETS[2]!.address;
const PYUSD_BEACON = '0x1111111111111111111111111111111111111111';
const PYUSD_IMPLEMENTATION = '0x2222222222222222222222222222222222222222';
const PYUSD_ADMIN = '0x3333333333333333333333333333333333333333';
const USDC_IMPLEMENTATION = '0x4444444444444444444444444444444444444444';
const USDC_ADMIN = '0x5555555555555555555555555555555555555555';

const CODES = Object.freeze({
  [PYUSD]: '0x6001',
  [PYUSD_BEACON]: '0x6002',
  [PYUSD_IMPLEMENTATION]: '0x6003',
  [USDC]: '0x6004',
  [USDC_IMPLEMENTATION]: '0x6005',
  [USDT]: '0x6006',
});

interface MutableEpoch {
  validFromBlock: string;
  validThroughBlock: string | null;
  evidence: { captureBlockNumber: string; captureBlockHash: string; sha256: string };
  deployment: Record<string, unknown>;
}

interface MutableManifest {
  schemaVersion: number;
  use: string;
  approvalStatus: string;
  authorityApprovedForProduction: boolean;
  networkId: string;
  chainId: string;
  blockBinding: string;
  maximumRpcReads: number;
  maximumRuntimeCodeBytes: number;
  maximumEpochsPerAsset: number;
  assetRegistry: { environment: string; version: number; fingerprintSha256: string };
  assets: Array<{
    stablecoin: string;
    address: string;
    decimals: number;
    epochs: MutableEpoch[];
  }>;
}

interface TranscriptOptions {
  readonly pyusdImplementationRoute?: boolean;
  readonly deprecatedWord?: string;
  readonly upgradedAddressWord?: string;
  readonly beaconImplementationWord?: string;
  readonly codeOverrides?: Readonly<Record<string, string>>;
  readonly storageOverrides?: Readonly<Record<string, string>>;
  readonly blockHash?: string;
  readonly abortAtRead?: number;
  readonly executionOwner?: BalanceSyncExecutionContextOwner;
}

interface CapturedRequest {
  readonly request: BalanceJsonRpcRequest;
  readonly signal: AbortSignal;
}

class TranscriptTransport implements BalanceJsonRpcTransport {
  readonly requests: CapturedRequest[] = [];

  constructor(private readonly options: TranscriptOptions = {}) {}

  async exchange(request: BalanceJsonRpcRequest, signal: AbortSignal): Promise<unknown> {
    this.requests.push({ request, signal });
    if (this.requests.length === this.options.abortAtRead) {
      this.options.executionOwner?.abort('SHUTDOWN');
    }
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: this.result(request),
    };
  }

  private result(request: BalanceJsonRpcRequest): unknown {
    switch (request.method) {
      case 'eth_chainId':
        return '0x1';
      case 'eth_getBlockByNumber':
        return { number: BLOCK_NUMBER, hash: this.options.blockHash ?? BLOCK_HASH };
      case 'eth_getCode': {
        const address = request.params[0];
        if (typeof address !== 'string' || !(address in CODES)) throw new Error('unexpected code');
        const override = this.options.codeOverrides?.[address];
        if (override !== undefined) return override;
        return CODES[address as keyof typeof CODES];
      }
      case 'eth_getStorageAt': {
        const address = request.params[0];
        const slot = request.params[1];
        if (typeof address !== 'string' || typeof slot !== 'string') {
          throw new Error('unexpected storage request');
        }
        const key = `${address}\0${slot}`;
        const override = this.options.storageOverrides?.[key];
        if (override !== undefined) return override;
        if (address === PYUSD && slot === EIP1967_ADMIN_SLOT) return addressWord(PYUSD_ADMIN);
        if (
          address === PYUSD &&
          slot ===
            (this.options.pyusdImplementationRoute
              ? EIP1967_IMPLEMENTATION_SLOT
              : EIP1967_BEACON_SLOT)
        ) {
          return addressWord(
            this.options.pyusdImplementationRoute ? PYUSD_IMPLEMENTATION : PYUSD_BEACON,
          );
        }
        if (address === USDC && slot === LEGACY_ZEPPELIN_IMPLEMENTATION_SLOT) {
          return addressWord(USDC_IMPLEMENTATION);
        }
        if (address === USDC && slot === LEGACY_ZEPPELIN_ADMIN_SLOT) {
          return addressWord(USDC_ADMIN);
        }
        return ZERO_WORD;
      }
      case 'eth_call': {
        const call = request.params[0];
        if (typeof call !== 'object' || call === null || Array.isArray(call)) {
          throw new Error('unexpected call');
        }
        const { data, to } = call as Record<string, unknown>;
        if (data === '0x313ce567' && (to === PYUSD || to === USDC || to === USDT)) return word(6n);
        if (data === '0x5c60da1b' && to === PYUSD_BEACON) {
          return this.options.beaconImplementationWord ?? addressWord(PYUSD_IMPLEMENTATION);
        }
        if (data === '0x0e136b19' && to === USDT) {
          return this.options.deprecatedWord ?? ZERO_WORD;
        }
        if (data === '0x26976e3f' && to === USDT) {
          return this.options.upgradedAddressWord ?? ZERO_WORD;
        }
        throw new Error('unexpected call');
      }
      default:
        throw new Error('unexpected method');
    }
  }
}

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function runtime(address: keyof typeof CODES): { byteLength: number; sha256: string } {
  const value = CODES[address];
  if (value === undefined) throw new TypeError('missing test runtime code');
  const bytes = Buffer.from(value.slice(2), 'hex');
  return { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function evidence(label: string): MutableEpoch['evidence'] {
  return {
    captureBlockNumber: '10',
    captureBlockHash: `0x${'b'.repeat(64)}`,
    sha256: sha(label),
  };
}

function approvedManifest(): MutableManifest {
  return {
    schemaVersion: 1,
    use: 'DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_IDENTITY_ONLY',
    approvalStatus: 'APPROVED',
    authorityApprovedForProduction: true,
    networkId: 'eip155:1',
    chainId: '0x1',
    blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
    maximumRpcReads: ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS,
    maximumRuntimeCodeBytes: ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES,
    maximumEpochsPerAsset: ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET,
    assetRegistry: {
      environment: 'MAINNET',
      version: 1,
      fingerprintSha256: ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256,
    },
    assets: [
      {
        stablecoin: 'PYUSD',
        address: PYUSD,
        decimals: 6,
        epochs: [
          {
            validFromBlock: '1',
            validThroughBlock: null,
            evidence: evidence('pyusd'),
            deployment: {
              kind: 'EIP1967_BEACON',
              proxyRuntimeCode: runtime(PYUSD),
              beacon: PYUSD_BEACON,
              beaconRuntimeCode: runtime(PYUSD_BEACON),
              implementation: PYUSD_IMPLEMENTATION,
              implementationRuntimeCode: runtime(PYUSD_IMPLEMENTATION),
              admin: PYUSD_ADMIN,
            },
          },
        ],
      },
      {
        stablecoin: 'USDC',
        address: USDC,
        decimals: 6,
        epochs: [
          {
            validFromBlock: '1',
            validThroughBlock: null,
            evidence: evidence('usdc'),
            deployment: {
              kind: 'LEGACY_ZEPPELIN_IMPLEMENTATION',
              proxyRuntimeCode: runtime(USDC),
              implementation: USDC_IMPLEMENTATION,
              implementationRuntimeCode: runtime(USDC_IMPLEMENTATION),
              admin: USDC_ADMIN,
            },
          },
        ],
      },
      {
        stablecoin: 'USDT',
        address: USDT,
        decimals: 6,
        epochs: [
          {
            validFromBlock: '1',
            validThroughBlock: null,
            evidence: evidence('usdt'),
            deployment: {
              kind: 'DIRECT',
              runtimeCode: runtime(USDT),
              semantics: 'TETHER_DEPRECATION_GUARD',
            },
          },
        ],
      },
    ],
  };
}

function verifier(
  transport: BalanceJsonRpcTransport,
  manifest: MutableManifest = approvedManifest(),
): EthereumMainnetBalanceDeploymentIdentityVerifierPort {
  return createDormantEthereumMainnetBalanceDeploymentIdentityVerifier({
    transport,
    approvedManifest: manifest,
    requiredApprovedManifestFingerprintSha256:
      ethereumMainnetBalanceDeploymentManifestFingerprintSha256(manifest),
  });
}

function request(): EthereumMainnetBalanceDeploymentIdentityVerificationRequest {
  return {
    networkId: 'eip155:1',
    sourcePosition: POSITION,
    sourceHash: BLOCK_HASH,
    assetIdentities: ETHEREUM_MAINNET_BALANCE_ASSETS.map(({ address }) => address),
  };
}

async function attest(
  capability: EthereumMainnetBalanceDeploymentIdentityVerifierPort,
  owner: BalanceSyncExecutionContextOwner = createBalanceSyncExecutionContext(),
): Promise<unknown> {
  return attestEthereumMainnetBalanceDeploymentIdentity(capability, request(), owner.context);
}

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function addressWord(address: string): string {
  return `0x${'0'.repeat(24)}${address.slice(2)}`;
}

function storageKey(address: string, slot: string): string {
  return `${address}\0${slot}`;
}

describe('dormant Ethereum mainnet balance deployment identity verifier', () => {
  it('performs no I/O on construction and verifies beacon, legacy Zeppelin, and guarded direct routes', async () => {
    const transport = new TranscriptTransport();
    const manifest = approvedManifest();
    const capability = verifier(transport, manifest);
    expect(transport.requests).toHaveLength(0);
    const owner = createBalanceSyncExecutionContext();

    const value = await attest(capability, owner);
    const claims = reviewMainnetBalanceDeploymentIdentityAttestation(value, request());

    expect(claims).toEqual({
      deploymentIdentityValidated: true,
      approvedManifestFingerprintSha256:
        ethereumMainnetBalanceDeploymentManifestFingerprintSha256(manifest),
      observedIdentityFingerprintSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(transport.requests).toHaveLength(40);
    expect(transport.requests.every(({ signal }) => signal === owner.context.signal)).toBe(true);
    const exactBlock = { blockHash: BLOCK_HASH, requireCanonical: true };
    for (const { request: captured } of transport.requests) {
      if (captured.method === 'eth_getCode') expect(captured.params[1]).toEqual(exactBlock);
      if (captured.method === 'eth_getStorageAt') expect(captured.params[2]).toEqual(exactBlock);
      if (captured.method === 'eth_call') expect(captured.params[1]).toEqual(exactBlock);
    }
    expect(
      transport.requests.filter(({ request: captured }) => captured.method === 'eth_chainId'),
    ).toHaveLength(2);
    expect(
      transport.requests.filter(
        ({ request: captured }) => captured.method === 'eth_getBlockByNumber',
      ),
    ).toHaveLength(2);

    const repeated = reviewMainnetBalanceDeploymentIdentityAttestation(
      await attest(verifier(new TranscriptTransport(), manifest)),
      request(),
    );
    expect(repeated?.observedIdentityFingerprintSha256).toBe(
      claims?.observedIdentityFingerprintSha256,
    );
  });

  it('supports an explicitly manifested EIP-1967 implementation route', async () => {
    const manifest = approvedManifest();
    manifest.assets[0]!.epochs[0]!.deployment = {
      kind: 'EIP1967_IMPLEMENTATION',
      proxyRuntimeCode: runtime(PYUSD),
      implementation: PYUSD_IMPLEMENTATION,
      implementationRuntimeCode: runtime(PYUSD_IMPLEMENTATION),
      admin: PYUSD_ADMIN,
    };
    const transport = new TranscriptTransport({ pyusdImplementationRoute: true });

    const value = await attest(verifier(transport, manifest));

    expect(reviewMainnetBalanceDeploymentIdentityAttestation(value, request())).not.toBeNull();
    expect(
      transport.requests.some(
        ({ request: captured }) =>
          captured.method === 'eth_getStorageAt' &&
          captured.params[0] === PYUSD &&
          captured.params[1] === EIP1967_IMPLEMENTATION_SLOT,
      ),
    ).toBe(true);
  });

  it('requires an independently supplied, exact approved-manifest fingerprint before I/O', () => {
    const transport = new TranscriptTransport();
    const manifest = approvedManifest();

    expect(() =>
      createDormantEthereumMainnetBalanceDeploymentIdentityVerifier({
        transport,
        approvedManifest: manifest,
        requiredApprovedManifestFingerprintSha256: sha('wrong approval'),
      }),
    ).toThrow('Ethereum mainnet balance deployment identity verifier unavailable');
    expect(transport.requests).toHaveLength(0);
  });

  it('does not auto-detect a legacy proxy as direct runtime code', async () => {
    const manifest = approvedManifest();
    manifest.assets[1]!.epochs[0]!.deployment = {
      kind: 'DIRECT',
      runtimeCode: runtime(USDC),
      semantics: 'LOCAL_ERC20',
    };

    await expect(attest(verifier(new TranscriptTransport(), manifest))).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );
  });

  it.each([
    ['deprecated Tether', { deprecatedWord: word(1n) }],
    ['forwarding Tether', { upgradedAddressWord: addressWord(PYUSD_IMPLEMENTATION) }],
    ['changed exact block', { blockHash: `0x${'c'.repeat(64)}` }],
    [
      'nested beacon proxy',
      {
        storageOverrides: {
          [storageKey(PYUSD_BEACON, EIP1967_IMPLEMENTATION_SLOT)]:
            addressWord(PYUSD_IMPLEMENTATION),
        },
      },
    ],
    ['changed runtime code', { codeOverrides: { [USDT]: '0x6007' } }],
    ['empty runtime code', { codeOverrides: { [USDT]: '0x' } }],
    ['wrong beacon implementation', { beaconImplementationWord: addressWord(USDC_IMPLEMENTATION) }],
    [
      'changed legacy proxy admin',
      { storageOverrides: { [storageKey(USDC, LEGACY_ZEPPELIN_ADMIN_SLOT)]: ZERO_WORD } },
    ],
  ] as const)('fails closed for %s', async (_name, options) => {
    await expect(attest(verifier(new TranscriptTransport(options)))).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );
  });

  it('rejects an epoch gap before any RPC read', async () => {
    const manifest = approvedManifest();
    manifest.assets[1]!.epochs[0]!.validThroughBlock = '10';
    const transport = new TranscriptTransport();

    await expect(attest(verifier(transport, manifest))).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );
    expect(transport.requests).toHaveLength(0);
  });

  it('cooperatively stops issuing reads as soon as the shared execution context aborts', async () => {
    const owner = createBalanceSyncExecutionContext();
    const transport = new TranscriptTransport({ abortAtRead: 5, executionOwner: owner });

    await expect(attest(verifier(transport), owner)).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );
    expect(transport.requests).toHaveLength(5);
  });

  it('rejects malformed storage address words instead of truncating them', async () => {
    const malformed = `0x01${'0'.repeat(62)}`;
    const transport = new TranscriptTransport({
      storageOverrides: { [storageKey(USDC, LEGACY_ZEPPELIN_IMPLEMENTATION_SLOT)]: malformed },
    });

    await expect(attest(verifier(transport))).rejects.toThrow(
      'mainnet balance deployment identity verification unavailable',
    );
  });
});
