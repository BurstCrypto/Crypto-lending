import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { MAINNET_SUPPORTED_ASSET_REGISTRY } from '../../blockchain/domain/supported-asset-registry';
import {
  parseDormantMainnetFinancialActionIntent,
  type DormantMainnetFinancialActionIntentInputV1,
  type DormantMainnetFinancialActionIntentV1,
} from '../domain/dormant-mainnet-financial-action';
import {
  verifyEthereumMainnetSignedTransaction,
  type VerifiedEthereumMainnetSignedTransaction,
} from '../domain/ethereum-mainnet-signed-transaction.verifier';
import {
  fingerprintMainnetFinancialActionWriteManifest,
  MainnetFinancialActionWriteManifestMatchError,
  matchMainnetFinancialActionWriteManifest,
  type EthereumMainnetFinancialActionWriteManifestV1,
  type MainnetFinancialActionWriteManifestDraftV1,
  type SolanaMainnetFinancialActionWriteManifestV1,
} from './mainnet-financial-action-write-manifest';
import {
  verifySolanaMainnetSignedTransaction,
  type VerifiedSolanaMainnetSignedTransaction,
} from './solana-mainnet-signed-transaction.verifier';

const NOW = new Date('2026-09-08T12:00:00.000Z');
const EVM_KEY = `0x${'11'.repeat(32)}` as const;
const EVM_WALLET = privateKeyToAccount(EVM_KEY);
const EVM_MARKET = '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2';
const EVM_ASSET = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SOLANA_WALLET = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const SOLANA_MARKET = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 66)).publicKey;
const SOLANA_PROGRAM = Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => 77)).publicKey;
const SOLANA_ASSET = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const BLOCKHASH = new PublicKey(Uint8Array.from({ length: 32 }, () => 99)).toBase58();

function intentInput(
  overrides: Partial<DormantMainnetFinancialActionIntentInputV1> = {},
): DormantMainnetFinancialActionIntentInputV1 {
  const networkId = overrides.networkId ?? 'eip155:1';
  const solana = networkId.startsWith('solana:');
  return {
    schemaVersion: 1,
    intentId: '11111111-1111-4111-8111-111111111111',
    accountId: '22222222-2222-4222-8222-222222222222',
    walletRegistrationId: '33333333-3333-4333-8333-333333333333',
    replayProtectionId: '44444444-4444-4444-8444-444444444444',
    idempotencyKeyDigestSha256: 'ab'.repeat(32),
    networkId,
    walletAddress: solana ? SOLANA_WALLET.publicKey.toBase58() : EVM_WALLET.address,
    providerId: solana ? 'kamino' : 'aave',
    protocolId: solana ? 'kamino-lend' : 'aave-v3',
    marketId: solana ? SOLANA_MARKET.toBase58() : EVM_MARKET,
    assetRegistryVersion: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.version,
    assetRegistryFingerprintSha256: MAINNET_SUPPORTED_ASSET_REGISTRY.latest.fingerprintSha256,
    assetSymbol: 'USDC',
    assetIdentity: solana ? SOLANA_ASSET.toBase58() : EVM_ASSET,
    action: 'SUPPLY',
    amountAtomic: '1000000',
    requestedValueUsdMicros: '1000000',
    maximumNetworkFeeAtomic: '10000000',
    maximumNetworkFeeBasisPoints: 100,
    minimumPostActionNativeBalanceAtomic: '10000',
    allowanceMode: 'EXACT',
    allowanceAmountAtomic: '1000000',
    issuedAt: '2026-09-08T11:59:00.000Z',
    expiresAt: '2026-09-08T12:04:00.000Z',
    ...overrides,
  };
}

function intent(
  overrides: Partial<DormantMainnetFinancialActionIntentInputV1> = {},
): DormantMainnetFinancialActionIntentV1 {
  return parseDormantMainnetFinancialActionIntent(intentInput(overrides), NOW);
}

function reviewedManifest<T extends MainnetFinancialActionWriteManifestDraftV1>(
  draft: T,
): T & { readonly reviewedManifestFingerprintSha256: string } {
  return Object.freeze({
    ...draft,
    reviewedManifestFingerprintSha256: fingerprintMainnetFinancialActionWriteManifest(draft),
  }) as unknown as T & { readonly reviewedManifestFingerprintSha256: string };
}

function ethereumManifest(
  current: DormantMainnetFinancialActionIntentV1,
): EthereumMainnetFinancialActionWriteManifestV1 {
  return reviewedManifest({
    schemaVersion: 1,
    manifestId: 'test-aave-supply-v1',
    kind: 'ETHEREUM_EIP1559_ABI_CALL',
    networkId: 'eip155:1',
    providerId: 'aave',
    protocolId: 'aave-v3',
    marketId: current.marketId,
    assetRegistryVersion: current.assetRegistryVersion,
    assetRegistryFingerprintSha256: current.assetRegistryFingerprintSha256,
    assetSymbol: current.assetSymbol,
    assetIdentity: current.assetIdentity,
    action: 'SUPPLY',
    transactionTarget: current.marketId,
    functionSignature: 'supply(address,uint256,address,uint16)',
    arguments: [
      { encoding: 'ADDRESS', source: 'INTENT_ASSET_IDENTITY' },
      { encoding: 'UINT256', source: 'INTENT_AMOUNT_ATOMIC' },
      { encoding: 'ADDRESS', source: 'INTENT_WALLET_ADDRESS' },
      { encoding: 'UINT16', source: 'STATIC', value: '0' },
    ],
  });
}

async function verifiedEthereumCommand(
  current: DormantMainnetFinancialActionIntentV1,
): Promise<VerifiedEthereumMainnetSignedTransaction> {
  const data = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'supply',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'asset', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'onBehalfOf', type: 'address' },
          { name: 'referralCode', type: 'uint16' },
        ],
        outputs: [],
      },
    ],
    functionName: 'supply',
    args: [EVM_ASSET, 1_000_000n, EVM_WALLET.address, 0],
  });
  const wire = await EVM_WALLET.signTransaction({
    type: 'eip1559',
    chainId: 1,
    nonce: 9,
    gas: 100_000n,
    maxFeePerGas: 50n,
    maxPriorityFeePerGas: 2n,
    to: EVM_MARKET,
    value: 0n,
    data,
  });
  return verifyEthereumMainnetSignedTransaction({
    signedTransaction: wire,
    expectedWalletAddress: current.walletAddress,
    maximumNetworkFeeAtomic: current.maximumNetworkFeeAtomic,
  });
}

function solanaManifest(
  current: DormantMainnetFinancialActionIntentV1,
): SolanaMainnetFinancialActionWriteManifestV1 {
  return reviewedManifest({
    schemaVersion: 1,
    manifestId: 'test-kamino-supply-v1',
    kind: 'SOLANA_STATIC_INSTRUCTION_SEQUENCE',
    networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    providerId: 'kamino',
    protocolId: 'kamino-lend',
    marketId: current.marketId,
    assetRegistryVersion: current.assetRegistryVersion,
    assetRegistryFingerprintSha256: current.assetRegistryFingerprintSha256,
    assetSymbol: current.assetSymbol,
    assetIdentity: current.assetIdentity,
    action: 'SUPPLY',
    messageVersion: 0,
    instructions: [
      {
        programId: SOLANA_PROGRAM.toBase58(),
        accounts: [
          { source: 'INTENT_WALLET_ADDRESS', isSigner: true, isWritable: true },
          { source: 'INTENT_ASSET_IDENTITY', isSigner: false, isWritable: false },
          { source: 'INTENT_MARKET_ID', isSigner: false, isWritable: true },
        ],
        data: [
          { encoding: 'STATIC_HEX', value: '0123456789abcdef' },
          { encoding: 'U64_LE', source: 'INTENT_AMOUNT_ATOMIC' },
        ],
      },
    ],
  });
}

function verifiedSolanaCommand(
  current: DormantMainnetFinancialActionIntentV1,
): VerifiedSolanaMainnetSignedTransaction {
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(current.amountAtomic));
  const instruction = new TransactionInstruction({
    programId: SOLANA_PROGRAM,
    keys: [
      { pubkey: SOLANA_WALLET.publicKey, isSigner: true, isWritable: true },
      { pubkey: SOLANA_ASSET, isSigner: false, isWritable: false },
      { pubkey: SOLANA_MARKET, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([Buffer.from('0123456789abcdef', 'hex'), amount]),
  });
  const message = new TransactionMessage({
    payerKey: SOLANA_WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [instruction],
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([SOLANA_WALLET]);
  return verifySolanaMainnetSignedTransaction({
    signedTransactionBase64: Buffer.from(transaction.serialize()).toString('base64'),
    expectedWalletAddress: current.walletAddress,
  });
}

describe('mainnet financial-action exact write manifests', () => {
  it('matches exact Ethereum target, ABI arguments, signer-bound beneficiary, amount, and fee cap', async () => {
    const current = intent();
    const manifest = ethereumManifest(current);
    const command = await verifiedEthereumCommand(current);
    const match = matchMainnetFinancialActionWriteManifest('11'.repeat(32), current, command, [
      manifest,
    ]);

    expect(match.providerWriteManifestFingerprintSha256).toBe(
      manifest.reviewedManifestFingerprintSha256,
    );
    expect(match.providerActionBindingSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(() =>
      matchMainnetFinancialActionWriteManifest(
        '11'.repeat(32),
        current,
        {
          ...command,
          maximumNetworkFeeAtomic: '9999999',
        },
        [manifest],
      ),
    ).toThrow(expect.objectContaining({ code: 'SIGNED_COMMAND_MISMATCH' }));
  });

  it('matches the entire ordered Solana instruction, account metadata, and data', () => {
    const current = intent({ networkId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' });
    const manifest = solanaManifest(current);
    const command = verifiedSolanaCommand(current);
    expect(
      matchMainnetFinancialActionWriteManifest('22'.repeat(32), current, command, [manifest]),
    ).toMatchObject({
      providerWriteManifestFingerprintSha256: manifest.reviewedManifestFingerprintSha256,
    });

    const firstInstruction = command.instructions[0];
    if (firstInstruction === undefined) throw new Error('fixture instruction missing');
    expect(() =>
      matchMainnetFinancialActionWriteManifest(
        '22'.repeat(32),
        current,
        {
          ...command,
          instructions: [{ ...firstInstruction, dataHex: `${firstInstruction.dataHex}00` }],
        },
        [manifest],
      ),
    ).toThrow(expect.objectContaining({ code: 'SIGNED_COMMAND_MISMATCH' }));
  });

  it('is all-deny with the production registry and fails closed on duplicates or altered fingerprints', async () => {
    const current = intent();
    const command = await verifiedEthereumCommand(current);
    const manifest = ethereumManifest(current);
    expect(() =>
      matchMainnetFinancialActionWriteManifest('33'.repeat(32), current, command),
    ).toThrow(expect.objectContaining({ code: 'WRITE_MANIFEST_UNAVAILABLE' }));
    expect(() =>
      matchMainnetFinancialActionWriteManifest('33'.repeat(32), current, command, [
        manifest,
        manifest,
      ]),
    ).toThrow(expect.objectContaining({ code: 'INVALID_WRITE_MANIFEST' }));
    expect(() =>
      matchMainnetFinancialActionWriteManifest('33'.repeat(32), current, command, [
        { ...manifest, reviewedManifestFingerprintSha256: '00'.repeat(32) },
      ]),
    ).toThrow(MainnetFinancialActionWriteManifestMatchError);
  });

  it('rejects accessor-backed manifest data before reading it', () => {
    let accessed = false;
    const malicious = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get() {
        accessed = true;
        return 'ETHEREUM_EIP1559_ABI_CALL';
      },
    });
    expect(() =>
      fingerprintMainnetFinancialActionWriteManifest(
        malicious as MainnetFinancialActionWriteManifestDraftV1,
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_WRITE_MANIFEST' }));
    expect(accessed).toBe(false);
  });
});
