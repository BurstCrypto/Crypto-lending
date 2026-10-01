import { createRequire } from 'node:module';
import type { PublicKey, AccountInfo, TransactionInstruction } from '@solana/web3.js';
import type BN from 'bn.js';

// Save's declarations pull an older web3.js into the entire TS program through
// triple-slash references. Keep its runtime SDK behind this structural boundary.
const requireSdk = createRequire(import.meta.url);
export interface SaveReserve {
  lendingMarket: PublicKey;
  liquidity: { mintPubkey: PublicKey; mintDecimals: number; supplyPubkey: PublicKey; pythOracle: PublicKey; switchboardOracle: PublicKey;
    availableAmount: BN; borrowedAmountWads: BN; accumulatedProtocolFeesWads: BN };
  collateral: { mintPubkey: PublicKey; mintTotalSupply: BN };
  config: { depositLimit: BN; extraOracle?: PublicKey };
}
export const { parseReserve } = requireSdk('@solendprotocol/solend-sdk/state/reserve') as {
  parseReserve: (key: PublicKey, info: AccountInfo<Buffer>) => { info: SaveReserve };
};
export const { calculateSupplyInterest } = requireSdk('@solendprotocol/solend-sdk/core/utils/rates') as {
  calculateSupplyInterest: (reserve: SaveReserve, apy: boolean) => { toNumber(): number };
};
export const { depositReserveLiquidityInstruction } = requireSdk('@solendprotocol/solend-sdk/instructions/depositReserveLiquidity') as {
  depositReserveLiquidityInstruction: (amount: BN, source: PublicKey, destination: PublicKey, reserve: PublicKey, vault: PublicKey, mint: PublicKey, market: PublicKey, authority: PublicKey, wallet: PublicKey, program: PublicKey) => TransactionInstruction;
};
export const { redeemReserveCollateralInstruction } = requireSdk('@solendprotocol/solend-sdk/instructions/redeemReserveCollateral') as {
  redeemReserveCollateralInstruction: (amount: BN, source: PublicKey, destination: PublicKey, reserve: PublicKey, mint: PublicKey, vault: PublicKey, market: PublicKey, authority: PublicKey, wallet: PublicKey, program: PublicKey) => TransactionInstruction;
};
export const { refreshReserveInstruction } = requireSdk('@solendprotocol/solend-sdk/instructions/refreshReserve') as {
  refreshReserveInstruction: (reserve: PublicKey, program: PublicKey, pyth: PublicKey, switchboard?: PublicKey, extra?: PublicKey) => TransactionInstruction;
};
