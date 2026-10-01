import { PublicKey } from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { SOL_USDC } from './markets';

export function solanaLendingFeeInstructions(
  wallet: PublicKey,
  treasuryAddress: string,
  fee: bigint,
) {
  if (fee === 0n) return [];
  const treasury = new PublicKey(treasuryAddress),
    mint = new PublicKey(SOL_USDC);
  if (fee < 0n || wallet.equals(treasury)) throw new Error('Invalid lending fee recipient.');
  const destination = getAssociatedTokenAddressSync(mint, treasury, true);
  return [
    createAssociatedTokenAccountIdempotentInstruction(wallet, destination, treasury, mint),
    createTransferCheckedInstruction(
      getAssociatedTokenAddressSync(mint, wallet),
      mint,
      destination,
      wallet,
      fee,
      6,
    ),
  ];
}
