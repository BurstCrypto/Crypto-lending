import { createHash } from 'node:crypto';

import {
  DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_MANIFEST,
  ETHEREUM_MAINNET_BALANCE_ASSET_REGISTRY_FINGERPRINT_SHA256,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_EPOCHS_PER_ASSET,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_RPC_READS,
  ETHEREUM_MAINNET_BALANCE_MAXIMUM_RUNTIME_CODE_BYTES,
  EthereumMainnetBalanceDeploymentManifestValidationError,
  ethereumMainnetBalanceDeploymentManifestFingerprintSha256,
  parseApprovedEthereumMainnetBalanceDeploymentManifest,
} from './ethereum-mainnet-balance-deployment.manifest';

const BLOCK_HASH = `0x${'a'.repeat(64)}`;

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

function sha(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function code(value: string): Readonly<{ readonly byteLength: number; readonly sha256: string }> {
  const bytes = Buffer.from(value.slice(2), 'hex');
  return { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function evidence(label: string): {
  captureBlockNumber: string;
  captureBlockHash: string;
  sha256: string;
} {
  return {
    captureBlockNumber: '10',
    captureBlockHash: BLOCK_HASH,
    sha256: sha(label),
  };
}

function validManifest(): MutableManifest {
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
        address: '0x6c3ea9036406852006290770bedfcaba0e23a0e8',
        decimals: 6,
        epochs: [
          {
            validFromBlock: '1',
            validThroughBlock: null,
            evidence: evidence('pyusd'),
            deployment: {
              kind: 'EIP1967_BEACON',
              proxyRuntimeCode: code('0x6001'),
              beacon: '0x1111111111111111111111111111111111111111',
              beaconRuntimeCode: code('0x6002'),
              implementation: '0x2222222222222222222222222222222222222222',
              implementationRuntimeCode: code('0x6003'),
              admin: '0x3333333333333333333333333333333333333333',
            },
          },
        ],
      },
      {
        stablecoin: 'USDC',
        address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        decimals: 6,
        epochs: [
          {
            validFromBlock: '1',
            validThroughBlock: null,
            evidence: evidence('usdc'),
            deployment: {
              kind: 'LEGACY_ZEPPELIN_IMPLEMENTATION',
              proxyRuntimeCode: code('0x6004'),
              implementation: '0x4444444444444444444444444444444444444444',
              implementationRuntimeCode: code('0x6005'),
              admin: '0x5555555555555555555555555555555555555555',
            },
          },
        ],
      },
      {
        stablecoin: 'USDT',
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        decimals: 6,
        epochs: [
          {
            validFromBlock: '1',
            validThroughBlock: null,
            evidence: evidence('usdt'),
            deployment: {
              kind: 'DIRECT',
              runtimeCode: code('0x6006'),
              semantics: 'TETHER_DEPRECATION_GUARD',
            },
          },
        ],
      },
    ],
  };
}

function jsonClone(value: MutableManifest): MutableManifest {
  return JSON.parse(JSON.stringify(value)) as MutableManifest;
}

describe('Ethereum mainnet balance deployment manifest', () => {
  it('keeps the checked-in manifest empty and explicitly NOT_APPROVED', () => {
    expect(DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_MANIFEST).toMatchObject({
      approvalStatus: 'NOT_APPROVED',
      authorityApprovedForProduction: false,
      assets: [],
    });
    expect(() =>
      parseApprovedEthereumMainnetBalanceDeploymentManifest(
        DORMANT_ETHEREUM_MAINNET_BALANCE_DEPLOYMENT_MANIFEST,
      ),
    ).toThrow(EthereumMainnetBalanceDeploymentManifestValidationError);
  });

  it('parses all explicit route families and fingerprints canonical content', () => {
    const manifest = validManifest();
    const parsed = parseApprovedEthereumMainnetBalanceDeploymentManifest(manifest);

    expect(
      parsed.assets.map(({ stablecoin, epochs }) => [stablecoin, epochs[0]?.deployment.kind]),
    ).toEqual([
      ['PYUSD', 'EIP1967_BEACON'],
      ['USDC', 'LEGACY_ZEPPELIN_IMPLEMENTATION'],
      ['USDT', 'DIRECT'],
    ]);
    expect(Object.isFrozen(parsed.assets)).toBe(true);
    expect(ethereumMainnetBalanceDeploymentManifestFingerprintSha256(manifest)).toBe(
      ethereumMainnetBalanceDeploymentManifestFingerprintSha256(jsonClone(manifest)),
    );
  });

  it('changes the fingerprint when approved evidence changes', () => {
    const first = validManifest();
    const second = jsonClone(first);
    second.assets[0]!.epochs[0]!.evidence.sha256 = sha('different approved evidence');

    expect(ethereumMainnetBalanceDeploymentManifestFingerprintSha256(first)).not.toBe(
      ethereumMainnetBalanceDeploymentManifestFingerprintSha256(second),
    );
  });

  it.each([
    ['asset order', (value: ReturnType<typeof validManifest>) => value.assets.reverse()],
    [
      'registry fingerprint',
      (value: ReturnType<typeof validManifest>) => {
        value.assetRegistry.fingerprintSha256 = '0'.repeat(64);
      },
    ],
    [
      'USDT direct semantics',
      (value: ReturnType<typeof validManifest>) => {
        value.assets[2]!.epochs[0]!.deployment = {
          kind: 'DIRECT',
          runtimeCode: code('0x6006'),
          semantics: 'LOCAL_ERC20',
        };
      },
    ],
    [
      'duplicate beacon target',
      (value: ReturnType<typeof validManifest>) => {
        const deployment = value.assets[0]!.epochs[0]!.deployment;
        deployment.implementation = deployment.beacon;
      },
    ],
    [
      'cross-asset proxy target',
      (value: ReturnType<typeof validManifest>) => {
        value.assets[0]!.epochs[0]!.deployment.beacon =
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
      },
    ],
    [
      'open epoch before another epoch',
      (value: ReturnType<typeof validManifest>) => {
        value.assets[1]!.epochs.push({
          ...(JSON.parse(JSON.stringify(value.assets[1]!.epochs[0]!)) as MutableEpoch),
          validFromBlock: '20',
        });
      },
    ],
  ])('rejects a changed %s binding', (_name, mutate) => {
    const value = validManifest();
    mutate(value);
    expect(() => parseApprovedEthereumMainnetBalanceDeploymentManifest(value)).toThrow(
      EthereumMainnetBalanceDeploymentManifestValidationError,
    );
  });

  it('accepts sorted, non-overlapping closed and open epochs', () => {
    const value = validManifest();
    const original = value.assets[1]!.epochs[0]!;
    original.validThroughBlock = '19';
    value.assets[1]!.epochs.push({
      ...(JSON.parse(JSON.stringify(original)) as MutableEpoch),
      validFromBlock: '20',
      validThroughBlock: null,
      evidence: { ...original.evidence, captureBlockNumber: '20' },
    });

    expect(
      parseApprovedEthereumMainnetBalanceDeploymentManifest(value).assets[1]?.epochs,
    ).toHaveLength(2);
  });

  it('rejects unexpected keys and accessor-backed input without invoking accessors', () => {
    expect(() =>
      parseApprovedEthereumMainnetBalanceDeploymentManifest({ ...validManifest(), extra: true }),
    ).toThrow(EthereumMainnetBalanceDeploymentManifestValidationError);
    const getter = jest.fn(() => 'APPROVED');
    const value = validManifest() as unknown as Record<string, unknown>;
    Object.defineProperty(value, 'approvalStatus', { enumerable: true, get: getter });

    expect(() => parseApprovedEthereumMainnetBalanceDeploymentManifest(value)).toThrow(
      EthereumMainnetBalanceDeploymentManifestValidationError,
    );
    expect(getter).not.toHaveBeenCalled();
  });
});
