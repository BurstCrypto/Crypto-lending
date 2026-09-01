import { PublicKey } from '@solana/web3.js';

export const PUBLIC_TESTNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG' as const;
export const PUBLIC_TESTNET_CHAIN_REFERENCE = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
export const PUBLIC_TESTNET_CHAIN_ID = `solana:${PUBLIC_TESTNET_CHAIN_REFERENCE}` as const;
export const PUBLIC_TESTNET_RPC_ENDPOINT = 'https://api.devnet.solana.com/' as const;

export const PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC = 10_000_000n;
export const PUBLIC_TESTNET_PROOF_AMOUNT_ATOMIC_TEXT = '10000000' as const;
export const PUBLIC_TESTNET_PROOF_AMOUNT_SOL = '0.01' as const;
export const PUBLIC_TESTNET_ASSET_DECIMALS = 9 as const;
// Covers the fixed 0.01 SOL deposit, two possible token-account rents, and fee.
// It is deliberately conservative and is not a wallet fee quote.
export const PUBLIC_TESTNET_REQUIRED_NATIVE_BALANCE_LAMPORTS = 20_000_000n;
export const PUBLIC_TESTNET_MAX_TRANSACTION_BYTES = 1_232 as const;
export const PUBLIC_TESTNET_WALLET_COMPUTE_UNIT_LIMIT = 200_000 as const;
export const PUBLIC_TESTNET_WALLET_MAX_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 500_000n;
export const PUBLIC_TESTNET_WALLET_MAX_PRIORITY_FEE_LAMPORTS = 100_000n;
// Preserve enough post-acceptance lifetime for roughly two of an RPC node's
// generic two-second rebroadcast intervals, even when Devnet is advancing near
// six block heights per second. The power-of-two cushion also absorbs the race
// between this read-only guard and the leader receiving the signed bytes.
export const PUBLIC_TESTNET_MINIMUM_BROADCAST_REMAINING_BLOCK_HEIGHTS = 32n;
export const PUBLIC_TESTNET_INTENT_TTL_MILLISECONDS = 60 * 1_000;
export const PUBLIC_TESTNET_EVIDENCE_RETENTION_MILLISECONDS = 10 * 60 * 1_000;
export const PUBLIC_TESTNET_MAX_INTENTS = 256;
export const PUBLIC_TESTNET_MAX_ACTIVE_INTENTS_PER_ACCOUNT = 8;

export const PUBLIC_TESTNET_SOL_FAUCET = 'https://faucet.solana.com/' as const;
export const PUBLIC_TESTNET_EXPLORER = 'https://explorer.solana.com/' as const;

export const PUBLIC_TESTNET_LENDING_PROGRAM = new PublicKey(
  'ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx',
);
export const PUBLIC_TESTNET_LENDING_MARKET = new PublicKey(
  'GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp',
);
export const PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY = new PublicKey(
  'EhJ4fwaXUp7aiwvZThSUaGWCaBQAJe3AEaJJJVCn3UCK',
);
export const PUBLIC_TESTNET_SOL_RESERVE = new PublicKey(
  '5VVLD7BQp8y3bTgyF5ezm1ResyMTR3PhYsT4iHFU8Sxz',
);
export const PUBLIC_TESTNET_WRAPPED_SOL_MINT = new PublicKey(
  'So11111111111111111111111111111111111111112',
);
export const PUBLIC_TESTNET_RESERVE_LIQUIDITY_SUPPLY = new PublicKey(
  'furd3XUtjXZ2gRvSsoUts9A5m8cMJNqdsyR2Rt8vY9s',
);
export const PUBLIC_TESTNET_COLLATERAL_MINT = new PublicKey(
  'FzwZWRMc3GCqjSrcpVX3ueJc6UpcV6iWWb7ZMsTXE3Gf',
);
export const PUBLIC_TESTNET_RESERVE_COLLATERAL_SUPPLY = new PublicKey(
  'J5KGpESS8Zq2MvK4rtL6wKbeMRYZzb6TEzn8qPsZFgGd',
);
export const PUBLIC_TESTNET_TOKEN_PROGRAM = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);
export const PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
export const PUBLIC_TESTNET_MEMO_PROGRAM = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
);
export const PUBLIC_TESTNET_MEMO_PREFIX = 'crypto-lending:devnet-proof:v1:' as const;
export const PUBLIC_TESTNET_WITHDRAWAL_MEMO_PREFIX =
  'crypto-lending:devnet-withdrawal:v1:' as const;
export const PUBLIC_TESTNET_UPGRADEABLE_LOADER = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);
export const PUBLIC_TESTNET_LENDING_PROGRAM_DATA = new PublicKey(
  '9kYdswr51vGxagFVXqdEqMgFMEYy17Y9TkobUUhnLHQq',
);
export const PUBLIC_TESTNET_LENDING_PROGRAM_DEPLOYMENT_SLOT = 163_147_020n;
export const PUBLIC_TESTNET_LENDING_PROGRAM_UPGRADE_AUTHORITY = new PublicKey(
  'Aowncx5MXJV1zqixh93ZedyPMsT4qS6oA9frbGm8wEGq',
);

export const PUBLIC_TESTNET_DEPOSIT_RESERVE_LIQUIDITY_TAG = 4 as const;
export const PUBLIC_TESTNET_REDEEM_RESERVE_COLLATERAL_TAG = 5 as const;
export const PUBLIC_TESTNET_SYNC_NATIVE_TAG = 17 as const;
export const PUBLIC_TESTNET_INITIALIZE_ACCOUNT_3_TAG = 18 as const;
export const PUBLIC_TESTNET_CLOSE_ACCOUNT_TAG = 9 as const;
export const PUBLIC_TESTNET_CREATE_ASSOCIATED_TOKEN_IDEMPOTENT_TAG = 1 as const;

export const PUBLIC_TESTNET_WITHDRAWAL_TERMINAL_RETENTION_MILLISECONDS = 60 * 60 * 1_000;
export const PUBLIC_TESTNET_MAX_ACTIVE_WITHDRAWALS_PER_ACCOUNT = 1;

export function derivePublicTestnetAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), PUBLIC_TESTNET_TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    PUBLIC_TESTNET_ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

function assertFixedDeployment(): void {
  const [authority] = PublicKey.findProgramAddressSync(
    [PUBLIC_TESTNET_LENDING_MARKET.toBuffer()],
    PUBLIC_TESTNET_LENDING_PROGRAM,
  );
  if (!authority.equals(PUBLIC_TESTNET_LENDING_MARKET_AUTHORITY)) {
    throw new Error('Fixed public-testnet market authority is invalid');
  }
}

assertFixedDeployment();
