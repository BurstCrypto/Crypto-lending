import { createHash } from 'node:crypto';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from '@solana/web3.js';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  ETHEREUM,
  SOLANA,
  SOLANA_USDC,
  TOKEN_PROGRAM,
  MAX_U64,
  associatedUsdcAccount,
} from './source-plan.ts';
import {
  assertBoundCctpMessage,
  solanaCctpMintInstructions,
  type BoundCctpMessage,
} from './cctp-mint.ts';
import { checkedEthereumAddress, type EthereumSourceTransaction } from './ethereum-source.ts';
import { rememberSolanaDestination } from './solana-destination-verification.ts';

// Same main USDC reserve as the application's Kamino read manifest.
// Instruction interface: klend-sdk commit 38845294447623f6de3afc9dec29875f959f6f48.
export const KAMINO_PROGRAM = new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD');
export const KAMINO_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');
export const KAMINO_USDC_RESERVE = new PublicKey('D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59');
const reservePda = (seed: string, account = KAMINO_USDC_RESERVE) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), account.toBuffer()], KAMINO_PROGRAM)[0];
// This older main-market reserve records existing mint/vault accounts. They are
// not the PDAs produced by the SDK's current new-reserve initialization helpers.
// Pinned from its finalized Reserve account on both mainnet RPCs, 2026-09-14.
export const KAMINO_COLLATERAL_MINT = new PublicKey('B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D');
export const KAMINO_LIQUIDITY_VAULT = new PublicKey('Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6');
const meta = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({
  pubkey,
  isWritable,
  isSigner,
});

/** Reserve supply issues interest-bearing cTokens directly to the user's ATA (no borrowing obligation). */
export function kaminoUsdcSupplyInstructions(input: {
  user: PublicKey;
  principal: bigint;
}): readonly TransactionInstruction[] {
  if (
    input.user.equals(PublicKey.default) ||
    !PublicKey.isOnCurve(input.user.toBytes()) ||
    input.principal <= 0n ||
    input.principal > MAX_U64
  )
    throw new Error('INVALID_KAMINO_SUPPLY');
  const receiptAccount = PublicKey.findProgramAddressSync(
    [input.user.toBuffer(), TOKEN_PROGRAM.toBuffer(), KAMINO_COLLATERAL_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
  const createReceipt = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    data: Buffer.from([1]),
    keys: [
      meta(input.user, true, true),
      meta(receiptAccount, true),
      meta(input.user),
      meta(KAMINO_COLLATERAL_MINT),
      meta(SystemProgram.programId),
      meta(TOKEN_PROGRAM),
    ],
  });
  const data = Buffer.alloc(16);
  createHash('sha256').update('global:deposit_reserve_liquidity').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(input.principal, 8);
  const supply = new TransactionInstruction({
    programId: KAMINO_PROGRAM,
    data,
    keys: [
      meta(input.user, false, true),
      meta(KAMINO_USDC_RESERVE, true),
      meta(KAMINO_MARKET),
      meta(reservePda('lma', KAMINO_MARKET)),
      meta(SOLANA_USDC),
      meta(KAMINO_LIQUIDITY_VAULT, true),
      meta(KAMINO_COLLATERAL_MINT, true),
      meta(associatedUsdcAccount(input.user), true),
      meta(receiptAccount, true),
      meta(TOKEN_PROGRAM),
      meta(TOKEN_PROGRAM),
      meta(SYSVAR_INSTRUCTIONS_PUBKEY),
    ],
  });
  // deposit_reserve_liquidity refreshes reserve interest internally; it does not borrow or require oracle price refresh.
  return [createReceipt, supply];
}

/** Redeem wallet-held reserve cTokens into the same wallet's native USDC ATA. */
export function kaminoUsdcWithdrawInstructions(input: {
  user: PublicKey;
  collateralAmount: bigint;
}): readonly TransactionInstruction[] {
  if (
    input.user.equals(PublicKey.default) ||
    !PublicKey.isOnCurve(input.user.toBytes()) ||
    input.collateralAmount <= 0n ||
    input.collateralAmount > MAX_U64
  )
    throw new Error('INVALID_KAMINO_WITHDRAWAL');
  const receiptAccount = PublicKey.findProgramAddressSync(
    [input.user.toBuffer(), TOKEN_PROGRAM.toBuffer(), KAMINO_COLLATERAL_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
  const destination = associatedUsdcAccount(input.user);
  const data = Buffer.alloc(16);
  createHash('sha256').update('global:redeem_reserve_collateral').digest().copy(data, 0, 0, 8);
  data.writeBigUInt64LE(input.collateralAmount, 8);
  return [
    new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM,
      data: Buffer.from([1]),
      keys: [
        meta(input.user, true, true),
        meta(destination, true),
        meta(input.user),
        meta(SOLANA_USDC),
        meta(SystemProgram.programId),
        meta(TOKEN_PROGRAM),
      ],
    }),
    // Account order from klend's RedeemReserveCollateral account context.
    new TransactionInstruction({
      programId: KAMINO_PROGRAM,
      data,
      keys: [
        meta(input.user, false, true),
        meta(KAMINO_MARKET),
        meta(KAMINO_USDC_RESERVE, true),
        meta(reservePda('lma', KAMINO_MARKET)),
        meta(SOLANA_USDC),
        meta(KAMINO_COLLATERAL_MINT, true),
        meta(KAMINO_LIQUIDITY_VAULT, true),
        meta(receiptAccount, true),
        meta(destination, true),
        meta(TOKEN_PROGRAM),
        meta(TOKEN_PROGRAM),
        meta(SYSVAR_INSTRUCTIONS_PUBKEY),
      ],
    }),
  ];
}

/** One destination transaction mints to the user then deposits the net received USDC into the configured reserve. */
export function prepareSolanaCctpMintAndSupply(input: {
  bound: BoundCctpMessage;
  blockhash: string;
  circleFeeRecipient: PublicKey;
  lookupTables: readonly AddressLookupTableAccount[];
  computeUnits: number;
}): VersionedTransaction {
  assertBoundCctpMessage(input.bound);
  if (
    input.bound.plan.destinationNetwork !== SOLANA ||
    !Number.isInteger(input.computeUnits) ||
    input.computeUnits < 1 ||
    input.computeUnits > 1_400_000
  )
    throw new Error('INVALID_DESTINATION_SUPPLY');
  const user = new PublicKey(input.bound.plan.destinationWallet);
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: input.computeUnits }),
    ...solanaCctpMintInstructions(input),
    ...kaminoUsdcSupplyInstructions({ user, principal: input.bound.expectedReceivedAmount }),
  ];
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: user,
      recentBlockhash: input.blockhash,
      instructions,
    }).compileToV0Message([...input.lookupTables]),
  );
  if (transaction.serialize().length > 1232) throw new Error('DESTINATION_LOOKUP_TABLE_REQUIRED');
  return rememberSolanaDestination(transaction);
}

export const AAVE_SUPPLY_ROUTER_ABI = parseAbi([
  'function mintAndSupply(bytes message, bytes attestation, uint256 principal, uint256 minimumATokens)',
  'function mintAndSupplyWithPermit(bytes message, bytes attestation, uint256 principal, uint256 minimumATokens, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s)',
  'function usdc() view returns (address)',
  'function pool() view returns (address)',
  'function aToken() view returns (address)',
  'function messageTransmitter() view returns (address)',
]);

/** Requires an existing exact USDC allowance or an optional user-signed USDC permit. */
export function prepareEthereumCctpMintAndSupply(input: {
  bound: BoundCctpMessage;
  supplyRouter: Address;
  minimumATokens: bigint;
  permit?: { deadline: bigint; v: number; r: Hex; s: Hex };
}): EthereumSourceTransaction {
  assertBoundCctpMessage(input.bound);
  const { bound, minimumATokens } = input;
  if (
    bound.plan.destinationNetwork !== ETHEREUM ||
    minimumATokens <= 0n ||
    minimumATokens > bound.expectedReceivedAmount
  ) {
    throw new Error('INVALID_DESTINATION_SUPPLY');
  }
  const args = [
    bound.message,
    bound.attestation,
    bound.expectedReceivedAmount,
    minimumATokens,
  ] as const;
  const data = input.permit
    ? encodeFunctionData({
        abi: AAVE_SUPPLY_ROUTER_ABI,
        functionName: 'mintAndSupplyWithPermit',
        args: [...args, input.permit.deadline, input.permit.v, input.permit.r, input.permit.s],
      })
    : encodeFunctionData({ abi: AAVE_SUPPLY_ROUTER_ABI, functionName: 'mintAndSupply', args });
  return Object.freeze({
    from: checkedEthereumAddress(bound.plan.destinationWallet as Address),
    to: checkedEthereumAddress(input.supplyRouter),
    data,
    value: '0x0',
    chainId: '0x1',
  });
}
