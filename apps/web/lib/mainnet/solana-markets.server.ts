import { Program, AnchorProvider } from '@coral-xyz/anchor';
import {
  Connection,
  PublicKey,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Bank,
  MarginfiAccount,
  MARGINFI_IDL,
  deriveMarginfiAccount,
  computeBankSupplyApy,
  type MarginfiProgram,
} from '@0dotxyz/p0-ts-sdk';
import p0Instructions from '@0dotxyz/p0-ts-sdk/instructions';
import { getDepositIxs, getRedeemIxs, getLendingTokenDetails } from '@jup-ag/lend/earn';
import {
  parseReserve,
  calculateSupplyInterest,
  depositReserveLiquidityInstruction,
  redeemReserveCollateralInstruction,
  refreshReserveInstruction,
  type SaveReserve,
} from './save-sdk.server';
import BN from 'bn.js';
import {
  MARKETS,
  SAVE,
  PROJECT_ZERO,
  JUPITER,
  SOL_USDC,
  type LendingProvider,
} from '../lending/markets';
import { BridgeSolana } from './bridge-solana.server';
import { fingerprint } from './bridge-journal.server';
import { fail } from './policy';

export type AdditionalSolanaProvider = 'save' | 'project-0' | 'jupiter';
const USDC = new PublicKey(SOL_USDC),
  LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const PROGRAM_DATA = {
  save: 'DMCvGv1fS5rMcAvEDPDDBawPqbDRSzJh2Bo6qXCmgJkR',
  'project-0': '4Q8u2ny8YYgytJEncwZQfVWbd5axZtfgDxYKHehvPQR7',
  jupiter: '3zB5SLYJoqDPN21s54MCkLeDPuMKQH9vNCSaZKSWTZZd',
} as const;
const programId = (id: AdditionalSolanaProvider) =>
  new PublicKey(
    id === 'save' ? SAVE.program : id === 'project-0' ? PROJECT_ZERO.program : JUPITER.program,
  );
const ata = (wallet: PublicKey, mint = USDC) => getAssociatedTokenAddressSync(mint, wallet);
export const isAdditionalSolana = (id: LendingProvider): id is AdditionalSolanaProvider =>
  ['save', 'project-0', 'jupiter'].includes(id);
export function checkedTokenAmount(
  account: AccountInfo<Buffer> | null,
  wallet: PublicKey,
  mint: PublicKey,
): bigint {
  if (!account) return 0n;
  const data = account.data;
  if (
    !account.owner.equals(TOKEN_PROGRAM_ID) ||
    data.length !== 165 ||
    account.executable ||
    !new PublicKey(data.subarray(0, 32)).equals(mint) ||
    !new PublicKey(data.subarray(32, 64)).equals(wallet) ||
    data[108] !== 1 ||
    data.readUInt32LE(72) !== 0 ||
    data.readUInt32LE(129) !== 0
  )
    return fail('A lending token account has an unexpected owner, mint, or authority.');
  return data.readBigUInt64LE(64);
}
function checkedData(
  account: AccountInfo<Buffer> | null | undefined,
  owner: PublicKey,
  minimum = 8,
) {
  if (
    !account ||
    account.executable ||
    !account.owner.equals(owner) ||
    account.data.length < minimum
  )
    return fail('The protocol account has an unexpected owner or layout.');
  return account.data;
}
const bps = (apy: number) => {
  if (!Number.isFinite(apy) || apy < 0 || apy > 100)
    return fail('The protocol returned an invalid supply APY.');
  return BigInt(Math.floor(apy * 10_000)).toString();
};
export interface SolanaMarketState {
  provider: AdditionalSolanaProvider;
  observedAt: number;
  slot: number;
  apyBasisPoints: string;
  capacity: bigint | null;
  available: boolean;
  walletUsdc: bigint;
  nativeBalance: bigint;
  shares: bigint;
  supplied: bigint;
  positionAddress: PublicKey;
  receiptMint: PublicKey | null;
  createPosition: boolean;
  rentBytes: number;
  binding: string;
  bank?: Bank;
  reserve?: SaveReserve;
  position?: MarginfiAccount;
}

/** Resolve the SDK's exact fToken lookup with a point read. No indexed RPC or API key
 * is required, and this resolver cannot enumerate or select other Jupiter markets. */
export function jupiterConnection(connection: Connection): Connection {
  const scoped = Object.create(connection) as Connection;
  scoped.getTokenSupply = async (mint: PublicKey) => {
    if (![SOL_USDC, JUPITER.receipt].includes(mint.toBase58()))
      return fail('Only Jupiter USDC and its receipt mint can be queried.');
    const response = await connection.getAccountInfoAndContext(mint, { commitment: 'finalized' });
    const data = checkedData(response.value, TOKEN_PROGRAM_ID, 82);
    if (data.length !== 82 || data[44] !== 6 || data[45] !== 1)
      return fail('The Jupiter token mint changed.');
    const amount = data.readBigUInt64LE(36).toString();
    return {
      context: response.context,
      value: {
        amount,
        decimals: 6,
        uiAmount: null,
        uiAmountString: `${BigInt(amount) / 1_000_000n}.${(BigInt(amount) % 1_000_000n).toString().padStart(6, '0')}`,
      },
    };
  };
  scoped.getProgramAccounts = (async (
    program: PublicKey,
    config?: { filters?: { memcmp?: { offset: number; bytes: string } }[] },
  ) => {
    if (
      program.toBase58() !== JUPITER.program ||
      !config?.filters?.some(
        (filter) => filter.memcmp?.offset === 40 && filter.memcmp.bytes === JUPITER.receipt,
      )
    )
      return fail('Only the configured Jupiter USDC lending lookup is allowed.');
    const pubkey = new PublicKey(MARKETS.jupiter.target),
      account = await connection.getAccountInfo(pubkey, 'finalized');
    const data = checkedData(account, program, 72);
    if (
      !new PublicKey(data.subarray(8, 40)).equals(USDC) ||
      new PublicKey(data.subarray(40, 72)).toBase58() !== JUPITER.receipt
    )
      return fail('Jupiter USDC market identity changed.');
    return [{ pubkey, account: account! }];
  }) as unknown as Connection['getProgramAccounts'];
  return scoped;
}

export class SolanaLendingMarkets {
  constructor(readonly solana: BridgeSolana) {}
  p0Program(source = 0): MarginfiProgram {
    const provider = new AnchorProvider(
      this.solana.connections[source]!,
      {
        publicKey: PublicKey.default,
        signTransaction: async () => fail('Only the connected browser wallet can sign.'),
        signAllTransactions: async () => fail('Only the connected browser wallet can sign.'),
      },
      { commitment: 'finalized' },
    );
    return new Program(MARGINFI_IDL, provider) as unknown as MarginfiProgram;
  }
  positionAddress(provider: AdditionalSolanaProvider, wallet: PublicKey) {
    if (provider === 'project-0')
      return deriveMarginfiAccount(
        programId(provider),
        new PublicKey(PROJECT_ZERO.group),
        wallet,
        PROJECT_ZERO.accountIndex,
      )[0];
    return ata(wallet, new PublicKey(provider === 'save' ? SAVE.receipt : JUPITER.receipt));
  }
  async read(
    provider: AdditionalSolanaProvider,
    walletAddress?: string,
  ): Promise<SolanaMarketState> {
    const observedAt = Date.now(),
      slot = await this.solana.chain();
    const wallet = new PublicKey(walletAddress ?? '11111111111111111111111111111111'),
      program = programId(provider);
    const positionAddress = this.positionAddress(provider, wallet),
      receiptMint =
        provider === 'project-0'
          ? null
          : new PublicKey(provider === 'save' ? SAVE.receipt : JUPITER.receipt);
    const keys = [
      program,
      new PublicKey(MARKETS[provider].target),
      wallet,
      ata(wallet),
      positionAddress,
      ...(receiptMint ? [receiptMint] : []),
    ];
    const responses = await this.solana.accounts(keys, slot);
    const deployments = await Promise.all(
      this.solana.connections.map((connection) =>
        connection.getAccountInfo(new PublicKey(PROGRAM_DATA[provider]), {
          commitment: 'finalized',
          minContextSlot: slot,
          dataSlice: { offset: 0, length: 45 },
        }),
      ),
    );
    const summaries = responses.map(({ value }, source) => {
      const executable = value[0];
      if (
        !executable?.executable ||
        executable.owner.toBase58() !== LOADER ||
        executable.data.length !== 36 ||
        executable.data.readUInt32LE(0) !== 2 ||
        new PublicKey(executable.data.subarray(4)).toBase58() !== PROGRAM_DATA[provider]
      )
        return fail('The configured lending program changed.');
      const deployment = checkedData(deployments[source], new PublicKey(LOADER), 45);
      if (deployment.readUInt32LE(0) !== 3 || deployment.readBigUInt64LE(4) > BigInt(slot))
        return fail('Invalid lending program deployment.');
      const marketData = checkedData(value[1], program);
      if (receiptMint) {
        const mint = checkedData(value[5], TOKEN_PROGRAM_ID, 82);
        if (mint.length !== 82 || mint[44] !== 6 || mint[45] !== 1)
          return fail('The lending receipt mint changed.');
      }
      const state: SolanaMarketState = {
        provider,
        observedAt,
        slot,
        apyBasisPoints: '0',
        capacity: null,
        available: true,
        walletUsdc: checkedTokenAmount(value[3] ?? null, wallet, USDC),
        nativeBalance: BigInt(value[2]?.lamports ?? 0),
        shares: 0n,
        supplied: 0n,
        positionAddress,
        receiptMint,
        createPosition: !value[4],
        rentBytes: receiptMint ? 165 : this.p0Program(source).account.marginfiAccount.size,
        binding: fingerprint({
          provider,
          program: program.toBase58(),
          deployment: deployment.toString('hex'),
          target: keys[1]!.toBase58(),
        }),
      };
      if (provider === 'save') {
        const reserve = parseReserve(keys[1]!, value[1]!).info;
        if (
          reserve.lendingMarket.toBase58() !== SAVE.market ||
          !reserve.liquidity.mintPubkey.equals(USDC) ||
          reserve.liquidity.mintDecimals !== 6 ||
          reserve.collateral.mintPubkey.toBase58() !== SAVE.receipt ||
          reserve.liquidity.supplyPubkey.toBase58() !== SAVE.vault
        )
          return fail('Save main-pool USDC identities changed.');
        const total =
          BigInt(reserve.liquidity.availableAmount.toString()) +
          (BigInt(reserve.liquidity.borrowedAmountWads.toString()) -
            BigInt(reserve.liquidity.accumulatedProtocolFeesWads.toString())) /
            10n ** 18n;
        const limit = BigInt(reserve.config.depositLimit.toString()),
          totalShares = BigInt(reserve.collateral.mintTotalSupply.toString());
        state.shares = checkedTokenAmount(value[4] ?? null, wallet, receiptMint!);
        state.supplied = totalShares ? (state.shares * total) / totalShares : 0n;
        state.apyBasisPoints = bps(calculateSupplyInterest(reserve, true).toNumber());
        state.capacity = limit > total ? limit - total : 0n;
        state.available = limit > total;
        state.reserve = reserve;
      } else if (provider === 'project-0') {
        const idl = this.p0Program(source).idl,
          bank = Bank.fromAccountParsed(keys[1]!, Bank.decodeBankRaw(marketData, idl));
        if (
          bank.group.toBase58() !== PROJECT_ZERO.group ||
          !bank.mint.equals(USDC) ||
          bank.mintDecimals !== 6 ||
          bank.config.assetTag !== 0
        )
          return fail('Project 0 production USDC bank identity changed.');
        const limit = BigInt(bank.config.depositLimit.toFixed(0)),
          total = BigInt(bank.totalAssetShares.times(bank.assetShareValue).toFixed(0, 1));
        state.apyBasisPoints = bps(
          computeBankSupplyApy(bank as unknown as Parameters<typeof computeBankSupplyApy>[0]),
        );
        state.capacity = limit > total ? limit - total : 0n;
        state.available = bank.config.operationalState === 'Operational' && limit > total;
        state.bank = bank;
        if (value[4]) {
          const position = MarginfiAccount.fromAccountDataRaw(
            positionAddress,
            checkedData(value[4], program),
            idl,
          );
          if (
            !position.authority.equals(wallet) ||
            position.group.toBase58() !== PROJECT_ZERO.group
          )
            return fail('The Project 0 account does not belong to this wallet and group.');
          if (
            position.balances.some(
              (balance) =>
                balance.active &&
                (!balance.bankPk.equals(keys[1]!) || !balance.liabilityShares.isZero()),
            )
          )
            return fail(
              'This Project 0 account has other positions or debt. Use a wallet with a dedicated USDC lending account.',
            );
          const balance = position.balances.find(
            (item) => item.active && item.bankPk.equals(keys[1]!),
          );
          state.shares = balance ? BigInt(balance.assetShares.times(2 ** 48).toFixed(0)) : 0n;
          state.supplied = balance
            ? BigInt(balance.computeQuantity(bank).assets.toFixed(0, 1))
            : 0n;
          state.position = position;
        }
      } else state.shares = checkedTokenAmount(value[4] ?? null, wallet, receiptMint!);
      return state;
    });
    const [left, right] = summaries as [SolanaMarketState, SolanaMarketState];
    for (const key of [
      'binding',
      'walletUsdc',
      'nativeBalance',
      'shares',
      'createPosition',
      'available',
    ] as const)
      if (left[key] !== right[key]) return fail('The Solana lending sources disagree.');
    if (provider === 'jupiter') {
      const rates = await Promise.all(
        this.solana.connections.map((connection) =>
          getLendingTokenDetails({
            connection: jupiterConnection(connection),
            lendingToken: receiptMint!,
            market: 'main',
          }),
        ),
      );
      for (const rate of rates)
        if (!rate.asset.equals(USDC) || !rate.address.equals(receiptMint!) || rate.decimals !== 6)
          return fail('Jupiter USDC lending identity changed.');
      const bp = rates.map((rate) => BigInt(rate.supplyRate.toString()));
      if (
        bp.some((value) => value < 0n || value > 1_000_000n) ||
        (bp[0]! > bp[1]! ? bp[0]! - bp[1]! : bp[1]! - bp[0]!) > 1n
      )
        return fail('Jupiter lending rates disagree.');
      // The Earn SDK documents supplyRate as basis points of APY. Rewards are separate.
      left.apyBasisPoints = (bp[0]! < bp[1]! ? bp[0]! : bp[1]!).toString();
      left.supplied = (left.shares * BigInt(rates[0]!.convertToAssets.toString())) / 1_000_000n;
    } else {
      const a = BigInt(left.apyBasisPoints),
        b = BigInt(right.apyBasisPoints);
      if ((a > b ? a - b : b - a) > 1n) return fail('The Solana lending rates disagree.');
      left.apyBasisPoints = (a < b ? a : b).toString();
      if (left.capacity !== null && right.capacity !== null)
        left.capacity = left.capacity < right.capacity ? left.capacity : right.capacity;
    }
    return left;
  }
  async depositCost(state: SolanaMarketState): Promise<bigint> {
    const rents = state.createPosition
      ? await Promise.all(
          this.solana.connections.map((connection) =>
            connection.getMinimumBalanceForRentExemption(state.rentBytes, 'finalized'),
          ),
        )
      : [0, 0];
    if (rents[0] !== rents[1]) return fail('The Solana account-rent estimates disagree.');
    return 5_000n + BigInt(rents[0]!);
  }
  async instructions(
    state: SolanaMarketState,
    wallet: PublicKey,
    action: 'supply' | 'withdraw',
    amount: bigint,
    source = 0,
  ): Promise<TransactionInstruction[]> {
    const connection = this.solana.connections[source]!,
      provider = state.provider;
    if (provider === 'jupiter') {
      const output = action === 'supply' ? state.receiptMint! : USDC;
      const built =
        action === 'supply'
          ? await getDepositIxs({
              connection,
              signer: wallet,
              asset: USDC,
              amount: new BN(amount.toString()),
              market: 'main',
              includeATASetup: false,
            })
          : await getRedeemIxs({
              connection,
              signer: wallet,
              asset: USDC,
              shares: new BN(state.shares.toString()),
              market: 'main',
              includeATASetup: false,
            });
      return [
        createAssociatedTokenAccountIdempotentInstruction(
          wallet,
          ata(wallet, output),
          wallet,
          output,
        ),
        ...built.ixs,
      ];
    }
    if (provider === 'save') {
      const r = state.reserve!,
        authority = PublicKey.findProgramAddressSync(
          [new PublicKey(SAVE.market).toBuffer()],
          programId(provider),
        )[0];
      const output = action === 'supply' ? state.receiptMint! : USDC;
      const ixs = [
        createAssociatedTokenAccountIdempotentInstruction(
          wallet,
          ata(wallet, output),
          wallet,
          output,
        ),
        refreshReserveInstruction(
          new PublicKey(MARKETS.save.target),
          programId(provider),
          r.liquidity.pythOracle,
          r.liquidity.switchboardOracle,
          r.config.extraOracle,
        ),
      ];
      ixs.push(
        action === 'supply'
          ? depositReserveLiquidityInstruction(
              new BN(amount.toString()),
              ata(wallet),
              state.positionAddress,
              new PublicKey(MARKETS.save.target),
              r.liquidity.supplyPubkey,
              r.collateral.mintPubkey,
              r.lendingMarket,
              authority,
              wallet,
              programId(provider),
            )
          : redeemReserveCollateralInstruction(
              new BN(state.shares.toString()),
              state.positionAddress,
              ata(wallet),
              new PublicKey(MARKETS.save.target),
              r.collateral.mintPubkey,
              r.liquidity.supplyPubkey,
              r.lendingMarket,
              authority,
              wallet,
              programId(provider),
            ),
      );
      return ixs;
    }
    const program = this.p0Program(source),
      bank = state.bank!,
      ixs: TransactionInstruction[] = [];
    if (state.createPosition)
      ixs.push(
        await p0Instructions.makeInitMarginfiAccountPdaIx(
          program,
          {
            marginfiGroup: new PublicKey(PROJECT_ZERO.group),
            marginfiAccount: state.positionAddress,
            authority: wallet,
            feePayer: wallet,
          },
          { accountIndex: PROJECT_ZERO.accountIndex },
        ),
      );
    if (action === 'supply')
      ixs.push(
        await p0Instructions.makeDepositIx(
          program,
          {
            marginfiAccount: state.positionAddress,
            signerTokenAccount: ata(wallet),
            bank: bank.address,
            tokenProgram: TOKEN_PROGRAM_ID,
            group: bank.group,
            authority: wallet,
            liquidityVault: bank.liquidityVault,
          },
          { amount: new BN(amount.toString()), depositUpToLimit: false },
        ),
      );
    else {
      ixs.push(
        createAssociatedTokenAccountIdempotentInstruction(wallet, ata(wallet), wallet, USDC),
      );
      // Withdrawing the entire debt-free, single-bank position leaves no balances
      // needing oracle health checks. The program still checks withdrawal capacity.
      ixs.push(
        await p0Instructions.makeWithdrawIx(
          program,
          {
            marginfiAccount: state.positionAddress,
            destinationTokenAccount: ata(wallet),
            bank: bank.address,
            tokenProgram: TOKEN_PROGRAM_ID,
            group: bank.group,
            authority: wallet,
          },
          { amount: new BN(0), withdrawAll: true },
        ),
      );
    }
    return ixs;
  }
  async build(
    state: SolanaMarketState,
    walletAddress: string,
    action: 'supply' | 'withdraw',
    amount: bigint,
    feeInstructions: TransactionInstruction[] = [],
  ) {
    const wallet = new PublicKey(walletAddress),
      lifetime = await this.solana.blockhash(state.slot);
    const [left, right] = await Promise.all([
      this.instructions(state, wallet, action, amount, 0),
      this.instructions(state, wallet, action, amount, 1),
    ]);
    const digest = (ixs: TransactionInstruction[]) =>
      fingerprint(
        ixs.map((ix) => ({
          program: ix.programId.toBase58(),
          keys: ix.keys.map((key) => ({ ...key, pubkey: key.pubkey.toBase58() })),
          data: ix.data.toString('hex'),
        })),
      );
    if (
      digest(left) !== digest(right) ||
      left.some((ix) => ix.keys.some((key) => key.isSigner && !key.pubkey.equals(wallet)))
    )
      return fail('The protocol builders disagree or request another signer.');
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: wallet,
        recentBlockhash: lifetime.blockhash,
        // Set both compute instructions before review so wallets do not add a price
        // to the already reviewed transaction when signing it.
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
          ...left,
          ...feeInstructions,
        ],
      }).compileToV0Message(),
    );
    const bytes = transaction.serialize();
    if (bytes.length > 1232)
      return fail('This lending operation exceeds the Solana transaction size limit.');
    return { transaction, lifetime, serialized: Buffer.from(bytes).toString('base64') };
  }
  async simulate(
    state: SolanaMarketState,
    walletAddress: string,
    built: Awaited<ReturnType<SolanaLendingMarkets['build']>>,
    action: 'supply' | 'withdraw',
    amount: bigint,
    fee?: { treasury: string; balance: bigint; amount: bigint },
  ) {
    const wallet = new PublicKey(walletAddress),
      views: { debit: bigint; received: bigint; cost: bigint }[] = [];
    for (const connection of this.solana.connections) {
      // Some public RPCs report a slot for getBlockHeight. Epoch info provides
      // a block height with its slot so the expiry uses matching units.
      const epoch = await connection.getEpochInfo({
        commitment: 'confirmed',
        minContextSlot: state.slot,
      });
      if (
        !Number.isSafeInteger(epoch.blockHeight) ||
        epoch.blockHeight! < 0 ||
        epoch.absoluteSlot < state.slot
      )
        return fail('The Solana block height is unavailable or stale.');
      if (epoch.blockHeight! >= built.lifetime.lastValidBlockHeight - 10)
        return fail('The Solana transaction is expiring. Review a fresh transaction.');
      const result = await connection.simulateTransaction(built.transaction, {
        commitment: 'confirmed',
        sigVerify: false,
        minContextSlot: state.slot,
        accounts: {
          encoding: 'base64',
          addresses: [
            wallet.toBase58(),
            ata(wallet).toBase58(),
            state.positionAddress.toBase58(),
            ...(fee ? [ata(new PublicKey(fee.treasury)).toBase58()] : []),
          ],
        },
      });
      if (
        result.value.err ||
        !result.value.accounts ||
        (result.value.unitsConsumed ?? 600_001) > 600_000
      )
        return fail(
          `${MARKETS[state.provider].name} simulation did not succeed. Check funding and current market capacity.`,
        );
      const accounts = result.value.accounts.map((account) =>
        account
          ? {
              ...account,
              owner: new PublicKey(account.owner),
              data: Buffer.from(account.data[0]!, 'base64'),
            }
          : null,
      );
      const debit = state.walletUsdc - checkedTokenAmount(accounts[1]!, wallet, USDC),
        cost = state.nativeBalance - BigInt(accounts[0]?.lamports ?? 0);
      let received: bigint;
      if (state.receiptMint)
        received = checkedTokenAmount(accounts[2]!, wallet, state.receiptMint) - state.shares;
      else {
        const position = MarginfiAccount.fromAccountDataRaw(
          state.positionAddress,
          checkedData(accounts[2], programId(state.provider)),
          this.p0Program().idl,
        );
        const balance = position.balances.find(
          (item) => item.active && item.bankPk.toBase58() === MARKETS['project-0'].target,
        );
        received =
          (balance ? BigInt(balance.assetShares.times(2 ** 48).toFixed(0)) : 0n) - state.shares;
      }
      const routingFee = fee?.amount ?? 0n;
      if (
        fee &&
        checkedTokenAmount(accounts[3] ?? null, new PublicKey(fee.treasury), USDC) - fee.balance !==
          routingFee
      )
        return fail('The simulated routing fee did not reach the treasury.');
      if (
        action === 'supply'
          ? debit <= routingFee || debit > amount + routingFee || received <= 0n
          : debit >= 0n || received !== -state.shares
      )
        return fail('The simulated USDC or lending-position change does not match the review.');
      if (cost < 0n || cost > 20_000_000n)
        return fail('The Solana network and account setup cost exceeds its budget.');
      views.push({ debit, received, cost });
    }
    if (
      views[0]!.debit !== views[1]!.debit ||
      views[0]!.received !== views[1]!.received ||
      views[0]!.cost !== views[1]!.cost
    )
      return fail('The Solana lending simulations disagree.');
    return views[0]!;
  }
}
