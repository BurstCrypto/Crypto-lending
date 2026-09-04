import { createHash } from 'node:crypto';

const EVIDENCE_FINGERPRINT_DOMAIN =
  'crypto-lending:aave-v3-ethereum-deployment-evidence:v1' as const;
export const AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT = Object.freeze({
  schemaVersion: 1,
  sourceId: 'AAVE_V3_ETHEREUM_FINALIZED_RPC',
  use: 'DEPLOYMENT_CORROBORATION_ONLY',
  networkId: 'eip155:1',
  chainId: '0x1',
  blockSelector: 'finalized',
  blockBinding: 'EIP1898_BLOCK_HASH_REQUIRE_CANONICAL',
  deploymentManifestFingerprintSha256:
    '5a322f54a2209b0bb79ccd7cb415fd501c10c5ce9be8e6caa15e9d7badf548a7',
  assetRegistryFingerprintSha256:
    '5058b141479f114c1e5f87ed8798fbb7a7ffcce7b502aa7e0794dc53ca1f767d',
  readPlanFingerprintSha256: '332f1ec7b3f5d96ca0631f1de6b7ffbf764a2795abebe8f9d1df60075d374c4f',
  reserves: Object.freeze({
    USDC: Object.freeze({
      underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      aToken: '0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c',
      stableDebtToken: '0x0000000000000000000000000000000000000000',
      variableDebtToken: '0x72e95b8931767c79ba4eee721354d6e99a61d004',
    }),
    USDT: Object.freeze({
      underlyingAsset: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      aToken: '0x23878914efe38d27c4d67ab83ed1b93a74d4086a',
      stableDebtToken: '0x0000000000000000000000000000000000000000',
      variableDebtToken: '0x6df1c1e379bc5a00a7b4c6e67a203333772f45a8',
    }),
  }),
} as const);

export interface AaveV3EthereumDeploymentEvidenceFingerprintMaterial {
  readonly sourceReferenceId: string;
  readonly sourceObservationId: string;
  readonly finalizedBlock: Readonly<{
    number: bigint;
    hash: string;
    parentHash: string;
    stateRoot: string;
    timestamp: string;
  }>;
  readonly runtimeCodeKeccak256: Readonly<{
    poolAddressesProvider: string;
    poolProxy: string;
    poolImplementation: string;
    protocolDataProvider: string;
    usdcAToken: string;
    usdcVariableDebtToken: string;
    usdtAToken: string;
    usdtVariableDebtToken: string;
  }>;
  readonly reserves: Readonly<{
    USDC: Readonly<{
      underlyingAsset: string;
      aToken: string;
      stableDebtToken: string;
      variableDebtToken: string;
    }>;
    USDT: Readonly<{
      underlyingAsset: string;
      aToken: string;
      stableDebtToken: string;
      variableDebtToken: string;
    }>;
  }>;
}

/** Canonical source-specific fingerprint for one validated evidence observation. */
export function fingerprintAaveV3EthereumDeploymentEvidence(
  observation: AaveV3EthereumDeploymentEvidenceFingerprintMaterial,
  observedAt: string,
): string {
  const contract = AAVE_V3_ETHEREUM_DEPLOYMENT_EVIDENCE_CONTRACT;
  return createHash('sha256')
    .update(
      JSON.stringify([
        EVIDENCE_FINGERPRINT_DOMAIN,
        contract.schemaVersion,
        contract.sourceId,
        contract.use,
        false,
        false,
        contract.networkId,
        contract.chainId,
        contract.blockSelector,
        contract.blockBinding,
        true,
        true,
        true,
        'SOURCE_ATTESTED_UNVERIFIED',
        'UNVERIFIED',
        false,
        false,
        false,
        false,
        'UNVERIFIED_WITHOUT_DURABLE_CHECKPOINT',
        'UNVERIFIED_WITHOUT_LIVE_CAPABILITY_PROOF',
        observation.sourceReferenceId,
        observation.sourceObservationId,
        contract.deploymentManifestFingerprintSha256,
        contract.assetRegistryFingerprintSha256,
        contract.readPlanFingerprintSha256,
        observedAt,
        [
          observation.finalizedBlock.number.toString(),
          observation.finalizedBlock.hash,
          observation.finalizedBlock.parentHash,
          observation.finalizedBlock.stateRoot,
          observation.finalizedBlock.timestamp,
        ],
        [
          observation.runtimeCodeKeccak256.poolAddressesProvider,
          observation.runtimeCodeKeccak256.poolProxy,
          observation.runtimeCodeKeccak256.poolImplementation,
          observation.runtimeCodeKeccak256.protocolDataProvider,
          observation.runtimeCodeKeccak256.usdcAToken,
          observation.runtimeCodeKeccak256.usdcVariableDebtToken,
          observation.runtimeCodeKeccak256.usdtAToken,
          observation.runtimeCodeKeccak256.usdtVariableDebtToken,
        ],
        [
          [
            observation.reserves.USDC.underlyingAsset,
            observation.reserves.USDC.aToken,
            observation.reserves.USDC.stableDebtToken,
            observation.reserves.USDC.variableDebtToken,
          ],
          [
            observation.reserves.USDT.underlyingAsset,
            observation.reserves.USDT.aToken,
            observation.reserves.USDT.stableDebtToken,
            observation.reserves.USDT.variableDebtToken,
          ],
        ],
      ]),
      'utf8',
    )
    .digest('hex');
}
