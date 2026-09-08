import { parseTransaction, serializeTransaction, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  EthereumMainnetSignedTransactionVerificationError,
  verifyEthereumMainnetSignedTransaction,
  type VerifiedEthereumMainnetSignedTransaction,
} from './ethereum-mainnet-signed-transaction.verifier';

const PRIVATE_KEY = `0x${'11'.repeat(32)}` as const;
const OTHER_PRIVATE_KEY = `0x${'22'.repeat(32)}` as const;
const TARGET = '0x3333333333333333333333333333333333333333';
const MAXIMUM_FEE = '10000000';
const SECP256K1_ORDER = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
);

async function signed(overrides: Record<string, unknown> = {}): Promise<`0x${string}`> {
  return privateKeyToAccount(PRIVATE_KEY).signTransaction({
    type: 'eip1559',
    chainId: 1,
    nonce: 7,
    gas: 100_000n,
    maxFeePerGas: 50n,
    maxPriorityFeePerGas: 2n,
    to: TARGET,
    value: 0n,
    data: '0x12345678',
    ...overrides,
  });
}

async function verify(
  raw: string,
  wallet = privateKeyToAccount(PRIVATE_KEY).address.toLowerCase(),
): Promise<VerifiedEthereumMainnetSignedTransaction> {
  return verifyEthereumMainnetSignedTransaction({
    signedTransaction: raw,
    expectedWalletAddress: wallet,
    maximumNetworkFeeAtomic: MAXIMUM_FEE,
  });
}

describe('Ethereum mainnet signed-transaction verifier', () => {
  it('derives the signer, transaction id, signing evidence, and signer/nonce replay identity', async () => {
    const raw = await signed();
    const result = await verify(raw);

    expect(result).toMatchObject({
      kind: 'VERIFIED_ETHEREUM_EIP1559_TRANSACTION',
      networkId: 'eip155:1',
      signerWalletAddress: privateKeyToAccount(PRIVATE_KEY).address.toLowerCase(),
      nonce: '7',
      transactionTarget: TARGET,
      calldata: '0x12345678',
      gasLimit: '100000',
      maxFeePerGas: '50',
      maxPriorityFeePerGas: '2',
      maximumNetworkFeeAtomic: MAXIMUM_FEE,
    });
    expect(result.transactionId).toMatch(/^0x[0-9a-f]{64}$/u);
    for (const digest of [
      result.signedEnvelopeSha256,
      result.signingPayloadSha256,
      result.signatureEvidenceSha256,
      result.chainReplayIdentitySha256,
    ]) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects wrong networks, transaction families, contract creation, value, access lists, and fee excess', async () => {
    const candidates = [
      signed({ chainId: 2 }),
      privateKeyToAccount(PRIVATE_KEY).signTransaction({
        type: 'legacy',
        chainId: 1,
        nonce: 7,
        gas: 100_000n,
        gasPrice: 50n,
        to: TARGET,
        value: 0n,
        data: '0x12345678',
      }),
      signed({ to: undefined }),
      signed({ value: 1n }),
      signed({
        accessList: [
          {
            address: TARGET,
            storageKeys: [`0x${'00'.repeat(32)}`],
          },
        ],
      }),
    ];
    for (const candidate of await Promise.all(candidates)) {
      await expect(verify(candidate)).rejects.toBeInstanceOf(
        EthereumMainnetSignedTransactionVerificationError,
      );
    }
    await expect(
      verifyEthereumMainnetSignedTransaction({
        signedTransaction: await signed(),
        expectedWalletAddress: privateKeyToAccount(PRIVATE_KEY).address,
        maximumNetworkFeeAtomic: '4999999',
      }),
    ).rejects.toMatchObject({ code: 'ETHEREUM_NETWORK_FEE_LIMIT_EXCEEDED' });
  });

  it('rejects the wrong signer, noncanonical text, malformed evidence, and high-s malleability', async () => {
    const raw = await signed();
    await expect(verify(raw, privateKeyToAccount(OTHER_PRIVATE_KEY).address)).rejects.toMatchObject(
      {
        code: 'ETHEREUM_SIGNER_MISMATCH',
      },
    );
    await expect(verify(`0x${raw.slice(2).toUpperCase()}`)).rejects.toMatchObject({
      code: 'INVALID_ETHEREUM_SIGNED_TRANSACTION',
    });
    await expect(verify(`${raw.slice(0, -2)}00`)).rejects.toBeInstanceOf(
      EthereumMainnetSignedTransactionVerificationError,
    );

    const parsed = parseTransaction(raw);
    if (parsed.type !== 'eip1559' || parsed.s === undefined || parsed.yParity === undefined) {
      throw new Error('fixture did not contain an EIP-1559 signature');
    }
    const highS = SECP256K1_ORDER - BigInt(parsed.s);
    const malleated = serializeTransaction({
      ...parsed,
      s: toHex(highS, { size: 32 }),
      yParity: parsed.yParity === 0 ? 1 : 0,
    });
    await expect(verify(malleated)).rejects.toMatchObject({
      code: 'INVALID_ETHEREUM_SIGNED_TRANSACTION',
    });
  });

  it('uses signer plus nonce as replay identity across different replacement transaction hashes', async () => {
    const first = await verify(await signed({ data: '0x12345678' }));
    const replacement = await verify(await signed({ data: '0x87654321', maxFeePerGas: 60n }));

    expect(first.transactionId).not.toBe(replacement.transactionId);
    expect(first.chainReplayIdentitySha256).toBe(replacement.chainReplayIdentitySha256);
  });
});
