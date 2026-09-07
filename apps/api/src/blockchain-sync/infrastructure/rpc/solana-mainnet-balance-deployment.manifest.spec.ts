import {
  SOLANA_BPF_UPGRADEABLE_LOADER_V3,
  SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1,
  SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION,
  SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
  fingerprintSolanaMainnetBalanceDeploymentManifestV1,
  reviewSolanaMainnetBalanceDeploymentManifestV1,
  type SolanaMainnetBalanceDeploymentManifestContentV1,
  type SolanaMainnetBalanceDeploymentManifestV1,
} from './solana-mainnet-balance-deployment.manifest';

const PYUSD_MINT = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const LEGACY_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const LEGACY_PROGRAM_DATA = 'SysvarC1ock11111111111111111111111111111111';
const TOKEN_2022_PROGRAM_DATA = 'SysvarRent111111111111111111111111111111111';
const AUTHORITY = 'Vote111111111111111111111111111111111111111';

function approvedContent(): SolanaMainnetBalanceDeploymentManifestContentV1 {
  return {
    schemaVersion: SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_VERSION,
    environment: 'MAINNET',
    networkId: SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
    approvalStatus: 'APPROVED',
    approvedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-10-01T00:00:00.000Z',
    validFromSlot: '200',
    validThroughSlot: '300',
    assets: [
      {
        stablecoin: 'USDT',
        mintAddress: USDT_MINT,
        tokenProgramAddress: LEGACY_TOKEN_PROGRAM,
        decimals: 6,
        mintAuthorityAddress: AUTHORITY,
        freezeAuthorityAddress: null,
        mintConfigurationSha256: 'c'.repeat(64),
      },
      {
        stablecoin: 'PYUSD',
        mintAddress: PYUSD_MINT,
        tokenProgramAddress: TOKEN_2022_PROGRAM,
        decimals: 6,
        mintAuthorityAddress: AUTHORITY,
        freezeAuthorityAddress: AUTHORITY,
        mintConfigurationSha256: 'd'.repeat(64),
      },
      {
        stablecoin: 'USDC',
        mintAddress: USDC_MINT,
        tokenProgramAddress: LEGACY_TOKEN_PROGRAM,
        decimals: 6,
        mintAuthorityAddress: null,
        freezeAuthorityAddress: null,
        mintConfigurationSha256: 'e'.repeat(64),
      },
    ],
    programs: [
      {
        route: 'BPF_UPGRADEABLE_LOADER_V3',
        programAddress: TOKEN_2022_PROGRAM,
        loaderAddress: SOLANA_BPF_UPGRADEABLE_LOADER_V3,
        programDataAddress: TOKEN_2022_PROGRAM_DATA,
        deployedAtSlot: '150',
        upgradeAuthorityAddress: AUTHORITY,
        programBinarySha256: 'a'.repeat(64),
      },
      {
        route: 'BPF_UPGRADEABLE_LOADER_V3',
        programAddress: LEGACY_TOKEN_PROGRAM,
        loaderAddress: SOLANA_BPF_UPGRADEABLE_LOADER_V3,
        programDataAddress: LEGACY_PROGRAM_DATA,
        deployedAtSlot: '100',
        upgradeAuthorityAddress: null,
        programBinarySha256: 'b'.repeat(64),
      },
    ],
  };
}

function approvedManifest(): SolanaMainnetBalanceDeploymentManifestV1 {
  const content = approvedContent();
  return {
    ...content,
    fingerprintSha256: fingerprintSolanaMainnetBalanceDeploymentManifestV1(content),
  };
}

describe('Solana mainnet balance deployment manifest', () => {
  it('keeps the checked-in manifest empty, frozen, and unapproved', () => {
    expect(SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1).toMatchObject({
      schemaVersion: 1,
      environment: 'MAINNET',
      networkId: SOLANA_MAINNET_BALANCE_DEPLOYMENT_NETWORK_ID,
      approvalStatus: 'NOT_APPROVED',
      approvedAt: null,
      expiresAt: null,
      validFromSlot: null,
      validThroughSlot: null,
      assets: [],
      programs: [],
    });
    expect(SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1.fingerprintSha256).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(Object.isFrozen(SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1)).toBe(true);
    expect(Object.isFrozen(SOLANA_MAINNET_BALANCE_DEPLOYMENT_MANIFEST_V1.assets)).toBe(true);
  });

  it('owns, canonicalizes, and reviews an independently fingerprinted approved manifest', () => {
    const input = approvedManifest();
    const reviewed = reviewSolanaMainnetBalanceDeploymentManifestV1(input);

    expect(reviewed).not.toBeNull();
    expect(reviewed?.assets.map(({ mintAddress }) => mintAddress)).toEqual([
      PYUSD_MINT,
      USDC_MINT,
      USDT_MINT,
    ]);
    expect(reviewed?.programs.map(({ programAddress }) => programAddress)).toEqual([
      LEGACY_TOKEN_PROGRAM,
      TOKEN_2022_PROGRAM,
    ]);
    expect(reviewed).not.toBe(input);
    expect(Object.isFrozen(reviewed)).toBe(true);
    expect(Object.isFrozen(reviewed?.assets)).toBe(true);
    expect(reviewed?.fingerprintSha256).toBe(
      fingerprintSolanaMainnetBalanceDeploymentManifestV1(approvedContent()),
    );
  });

  it.each([
    ['tampered fingerprint', () => ({ ...approvedManifest(), fingerprintSha256: 'f'.repeat(64) })],
    [
      'missing asset',
      () => {
        const content = approvedContent();
        const invalid = { ...content, assets: content.assets.slice(1) };
        return { ...invalid, fingerprintSha256: 'a'.repeat(64) };
      },
    ],
    [
      'wrong program binding',
      () => {
        const content = approvedContent();
        const assets = content.assets.map((asset) =>
          asset.mintAddress === USDC_MINT
            ? { ...asset, tokenProgramAddress: TOKEN_2022_PROGRAM }
            : asset,
        );
        return { ...content, assets, fingerprintSha256: 'a'.repeat(64) };
      },
    ],
    [
      'deployment after epoch start',
      () => {
        const content = approvedContent();
        const programs = content.programs.map((program) => ({
          ...program,
          deployedAtSlot: '201',
        }));
        return { ...content, programs, fingerprintSha256: 'a'.repeat(64) };
      },
    ],
    [
      'populated unapproved manifest',
      () => ({ ...approvedManifest(), approvalStatus: 'NOT_APPROVED' }),
    ],
  ])('rejects %s', (_label, build) => {
    expect(reviewSolanaMainnetBalanceDeploymentManifestV1(build())).toBeNull();
  });

  it('rejects accessors and proxies without invoking caller code', () => {
    const getter = jest.fn(() => 'MAINNET');
    const accessor = approvedManifest() as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, 'environment', { enumerable: true, get: getter });

    expect(reviewSolanaMainnetBalanceDeploymentManifestV1(accessor)).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(
      reviewSolanaMainnetBalanceDeploymentManifestV1(
        new Proxy(approvedManifest(), {
          getOwnPropertyDescriptor: () => {
            throw new Error('must not escape');
          },
        }),
      ),
    ).toBeNull();
  });
});
