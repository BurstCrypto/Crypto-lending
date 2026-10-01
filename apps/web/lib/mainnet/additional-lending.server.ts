import { randomUUID } from 'node:crypto';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { decodeEventLog, encodeFunctionData, type Address, type Abi, type Hex } from 'viem';
import { ETHEREUM, MARKETS, ETH_USDC, SOL_USDC, type LendingProvider } from '../lending/markets';
import { marketCall, VAULT_ABI, COMET_ABI, BLUE_ABI, SPARK_ABI } from '../lending/evm-markets';
import { EthereumLendingMarkets } from './ethereum-markets.server';
import { SolanaLendingMarkets, isAdditionalSolana } from './solana-markets.server';
import { BridgeJournal, fingerprint } from './bridge-journal.server';
import { BridgeEthereum } from './bridge-ethereum.server';
import { BridgeSolana } from './bridge-solana.server';
import { TOKEN_ABI, fail } from './policy';
import type { BridgeStep, LocalWalletConfig } from './bridge-types';
import { lendingFeeEvidence } from '../lending/routing-fee';
import { solanaLendingFeeInstructions } from '../lending/solana-fee';
import { routedLendingCall } from '../lending/ethereum-router';

const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
const isApproval = (step: BridgeStep) => ['LENDING_APPROVAL', 'LENDING_REVOKE'].includes(step.kind);
export class AdditionalLendingService {
  readonly ethereumMarkets: EthereumLendingMarkets;
  readonly solanaMarkets: SolanaLendingMarkets;
  constructor(
    readonly journal: BridgeJournal,
    readonly ethereum: BridgeEthereum,
    readonly solana: BridgeSolana,
  ) {
    this.ethereumMarkets = new EthereumLendingMarkets(ethereum);
    this.solanaMarkets = new SolanaLendingMarkets(solana);
  }
  async prepare(
    config: LocalWalletConfig,
    provider: LendingProvider,
    action: 'supply' | 'withdraw',
    principal: bigint,
    evidence: Record<string, string> = {},
  ) {
    const market = MARKETS[provider],
      ethereum = market.network === ETHEREUM;
    const wallet = ethereum ? config.ethereumWallet : config.solanaWallet;
    if (!wallet || provider === 'aave' || provider === 'kamino')
      return fail('Choose a connected lending wallet and market.');
    const now = Date.now();
    const step: BridgeStep = {
      id: randomUUID(),
      bridgeId: null,
      network: market.network,
      wallet,
      kind: action === 'supply' ? 'LENDING_SUPPLY' : 'LENDING_WITHDRAW',
      state: 'PREPARED',
      createdAt: now,
      expiresAt: now + 120_000,
      fingerprint: '',
      transactionId: null,
      ethereum: null,
      solana: null,
      maxNetworkCost: '0',
      sourcePrincipal: principal.toString(),
      evidence: {
        ...evidence,
        provider,
        market: market.name,
        marketTarget: market.target,
        marketLabel: market.market,
        asset: 'USDC',
        action,
        amount: principal.toString(),
        ...lendingFeeEvidence(
          config,
          market.network,
          action,
          principal,
          Boolean(evidence.fundingBridgeId),
        ),
        ...(action === 'withdraw' ? { withdrawAll: 'true' } : {}),
      },
    };
    const platformFee = BigInt(step.evidence.platformFee!),
      totalDebit = principal + platformFee;
    const routed = action === 'supply' && !evidence.fundingBridgeId;
    if (ethereum) {
      const state = await this.ethereumMarkets.read(provider, wallet as Address);
      if (state.debt !== 0n)
        return fail(
          `This wallet has borrowing debt at ${market.name}. Use a lending-only position.`,
        );
      if (
        action === 'supply' &&
        (!state.available || (state.capacity !== null && principal > state.capacity))
      )
        return fail(`${market.name} cannot currently accept this amount.`);
      if (action === 'supply' && state.walletUsdc < totalDebit)
        return fail('The Ethereum wallet needs the deposit amount plus its routing fee.');
      if (action === 'withdraw' && state.shares <= 0n)
        return fail(`This wallet has no ${market.name} USDC position to withdraw.`);
      step.evidence.protocolBinding = state.binding;
      step.evidence.positionBefore = state.supplied.toString();
      step.evidence.shares = state.shares.toString();
      step.evidence.withdrawalFeeBps = state.withdrawalFeeBps.toString();
      if (action === 'withdraw') step.evidence.amount = state.supplied.toString();
      let call = marketCall(provider, wallet as Address, action, principal, state.shares);
      if (routed) {
        await this.ethereum.validateLendingRouter(config);
        step.evidence.lendingRouter = config.ethereumLendingRouter!;
        call = routedLendingCall(config.ethereumLendingRouter!, provider, principal);
      }
      const spender = routed ? config.ethereumLendingRouter! : (market.target as Address);
      const allowance = routed
        ? await this.ethereum.allowance(wallet as Address, spender)
        : state.allowance;
      if (action === 'supply' && allowance !== totalDebit) {
        const amount = allowance ? 0n : totalDebit;
        step.kind = amount ? 'LENDING_APPROVAL' : 'LENDING_REVOKE';
        step.sourcePrincipal = '0';
        step.evidence = {
          ...step.evidence,
          amount: amount.toString(),
          lendAmount: principal.toString(),
          spender,
        };
        call = {
          to: ETH_USDC,
          data: encodeFunctionData({
            abi: TOKEN_ABI,
            functionName: 'approve',
            args: [spender, amount],
          }),
        };
      } else if (provider === 'euler' || provider === 'gearbox') {
        const fn = action === 'supply' ? 'previewDeposit' : 'previewRedeem';
        const expected = BigInt(
          await this.ethereum.call(
            market.target as Address,
            encodeFunctionData({
              abi: VAULT_ABI,
              functionName: fn,
              args: [action === 'supply' ? principal : state.shares],
            }),
          ),
        );
        if (expected <= 0n)
          return fail('The vault would return no assets or shares for this amount.');
        step.evidence.expectedReceived = expected.toString();
        if (action === 'withdraw') step.evidence.amount = expected.toString();
      }
      const prepared = await this.ethereum.prepare({ from: wallet as Address, ...call }, step.kind);
      step.ethereum = prepared.transaction;
      step.maxNetworkCost = prepared.cost;
    } else {
      if (!isAdditionalSolana(provider)) return fail('Unsupported Solana lender.');
      const state = await this.solanaMarkets.read(provider, wallet);
      if (
        action === 'supply' &&
        (!state.available || (state.capacity !== null && principal > state.capacity))
      )
        return fail(`${market.name} cannot currently accept this amount.`);
      if (action === 'supply' && state.walletUsdc < totalDebit)
        return fail('The Solana wallet needs the deposit amount plus its routing fee.');
      if (action === 'withdraw' && state.shares <= 0n)
        return fail(`This wallet has no ${market.name} USDC position to withdraw.`);
      const feeAccount =
        platformFee > 0n
          ? await this.solana.routingFeeAccount(config.solanaTreasury, state.slot)
          : null;
      const fee = feeAccount
        ? { treasury: config.solanaTreasury, balance: feeAccount.balance, amount: platformFee }
        : undefined;
      const estimatedCost =
        (action === 'supply' ? await this.solanaMarkets.depositCost(state) : 5_000n) +
        (feeAccount?.rent ?? 0n);
      if (state.nativeBalance < estimatedCost)
        return fail(
          `${market.name} needs approximately ${Number(estimatedCost) / 1e9} SOL for this transaction and any new account.`,
        );
      const built = await this.solanaMarkets.build(
        state,
        wallet,
        action,
        principal,
        solanaLendingFeeInstructions(new PublicKey(wallet), config.solanaTreasury, platformFee),
      );
      const simulated = await this.solanaMarkets.simulate(
        state,
        wallet,
        built,
        action,
        principal,
        fee,
      );
      step.evidence = {
        ...step.evidence,
        protocolBinding: state.binding,
        positionBefore: state.supplied.toString(),
        shares: state.shares.toString(),
        positionAddress: state.positionAddress.toBase58(),
        receiptMint: state.receiptMint?.toBase58() ?? '',
        expectedReceived: simulated.received.toString(),
        expectedDebit: (simulated.debit - platformFee).toString(),
        expectedTotalDebit: simulated.debit.toString(),
        createsPosition: String(state.createPosition),
      };
      if (action === 'withdraw') step.evidence.amount = (-simulated.debit).toString();
      step.solana = {
        serialized: built.serialized,
        message: Buffer.from(built.transaction.message.serialize()).toString('base64'),
        version: 0,
        lastValidBlockHeight: built.lifetime.lastValidBlockHeight,
        contextSlot: built.lifetime.contextSlot,
      };
      step.maxNetworkCost = simulated.cost.toString();
      step.expiresAt = Date.now() + 120_000;
    }
    step.fingerprint = fingerprint({
      ethereum: step.ethereum,
      solana: step.solana,
      evidence: step.evidence,
    });
    return this.journal.createStep(step);
  }
  async reserve(step: BridgeStep) {
    const provider = step.evidence.provider as LendingProvider,
      amount = BigInt(step.evidence.amount!),
      supply = step.kind !== 'LENDING_WITHDRAW';
    if (step.network === ETHEREUM) {
      const state = await this.ethereumMarkets.read(provider, step.wallet as Address);
      if (state.binding !== step.evidence.protocolBinding || state.debt !== 0n)
        return fail('The lending deployment or borrowing position changed. Review again.');
      if (
        supply &&
        (!state.available || state.walletUsdc < BigInt(step.evidence.totalSourceDebit!))
      )
        return fail('The market or wallet can no longer fund this deposit and its routing fee.');
      const allowance = step.evidence.lendingRouter
        ? await this.ethereum.allowance(
            step.wallet as Address,
            step.evidence.lendingRouter as Address,
          )
        : state.allowance;
      if (step.kind === 'LENDING_SUPPLY' && allowance !== BigInt(step.evidence.totalSourceDebit!))
        return fail('The market allowance changed. Review again.');
      if (!supply && state.shares < BigInt(step.evidence.shares!))
        return fail('The lending position changed. Review the withdrawal again.');
      await this.ethereum.revalidate(step);
    } else {
      if (!isAdditionalSolana(provider) || !step.solana)
        return fail('Invalid Solana lending review.');
      const state = await this.solanaMarkets.read(provider, step.wallet);
      const feeAmount = BigInt(step.evidence.platformFee!);
      const feeAccount =
        feeAmount > 0n
          ? await this.solana.routingFeeAccount(step.evidence.feeTreasury!, state.slot)
          : null;
      if (supply && state.walletUsdc < BigInt(step.evidence.totalSourceDebit!))
        return fail('The wallet can no longer fund the deposit and its routing fee.');
      if (
        state.binding !== step.evidence.protocolBinding ||
        (!supply && state.shares !== BigInt(step.evidence.shares!))
      )
        return fail('The lending deployment or position changed. Review again.');
      const simulated = await this.solanaMarkets.simulate(
        state,
        step.wallet,
        {
          transaction: VersionedTransaction.deserialize(
            Buffer.from(step.solana.serialized, 'base64'),
          ),
          serialized: step.solana.serialized,
          lifetime: {
            blockhash: VersionedTransaction.deserialize(
              Buffer.from(step.solana.serialized, 'base64'),
            ).message.recentBlockhash,
            lastValidBlockHeight: step.solana.lastValidBlockHeight,
            contextSlot: step.solana.contextSlot,
          },
        },
        supply ? 'supply' : 'withdraw',
        amount,
        feeAccount
          ? { treasury: step.evidence.feeTreasury!, balance: feeAccount.balance, amount: feeAmount }
          : undefined,
      );
      if (simulated.cost > BigInt(step.maxNetworkCost) || state.nativeBalance < simulated.cost)
        return fail('The transaction cost changed. Review again.');
    }
    return this.journal.reserveStep(step.id, Date.now(), step.solana);
  }
  async verify(step: BridgeStep, receipt: unknown): Promise<NonNullable<BridgeStep['outcome']>> {
    const provider = step.evidence.provider as LendingProvider,
      market = MARKETS[provider],
      amount = BigInt(step.evidence.amount!);
    if (step.network !== ETHEREUM) {
      const meta = (receipt as { meta: unknown }).meta,
        change = this.solana.tokenChange(meta, step.wallet, SOL_USDC);
      const fee = BigInt(step.evidence.platformFee!);
      if (fee > 0n && this.solana.tokenChange(meta, step.evidence.feeTreasury!, SOL_USDC) !== fee)
        return fail('The finalized routing fee did not reach the treasury.');
      if (step.kind === 'LENDING_SUPPLY' ? change >= -fee || -change > amount + fee : change <= 0n)
        return fail('The finalized lending USDC change was not verified.');
      if (step.evidence.receiptMint) {
        const shares = this.solana.tokenChange(meta, step.wallet, step.evidence.receiptMint);
        if (
          step.kind === 'LENDING_SUPPLY' ? shares <= 0n : shares !== -BigInt(step.evidence.shares!)
        )
          return fail('The finalized receipt-token change was not verified.');
      } else {
        // The exact finalized message credits the wallet-owned marginfi PDA.
        // Corroborate its position increase; this account is not a token mint.
        if (provider !== 'project-0') return fail('Unexpected account-based lending provider.');
        const state = await this.solanaMarkets.read(provider, step.wallet);
        if (
          step.kind === 'LENDING_SUPPLY'
            ? state.shares <= BigInt(step.evidence.shares!)
            : state.shares !== 0n
        )
          return fail('The Project 0 position change could not be verified.');
      }
      return { usdcAmount: (change < 0n ? -change - fee : change).toString() };
    }
    const abi: Abi = isApproval(step)
      ? TOKEN_ABI
      : provider === 'morpho'
        ? BLUE_ABI
        : provider === 'compound'
          ? COMET_ABI
          : provider === 'spark'
            ? SPARK_ABI
            : VAULT_ABI;
    const logs = (receipt as { logs: { address: string; data: Hex; topics: Hex[] }[] }).logs;
    const events = logs.flatMap((log) => {
      try {
        const e = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        return [
          {
            address: log.address.toLowerCase(),
            name: e.eventName,
            args: e.args as unknown as Record<string, unknown>,
          },
        ];
      } catch {
        return [];
      }
    });
    if (isApproval(step)) {
      if (
        !events.some(
          (e) =>
            e.address === ETH_USDC &&
            e.name === 'Approval' &&
            same(e.args.owner, step.wallet) &&
            same(e.args.spender, step.evidence.spender ?? market.target) &&
            e.args.value === amount,
        )
      )
        return fail('The exact market allowance was not verified.');
      return { usdcAmount: '0' };
    }
    const supply = step.kind === 'LENDING_SUPPLY';
    const caller = supply ? (step.evidence.lendingRouter ?? step.wallet) : step.wallet;
    const event = events.find((e) => {
      if (
        e.address !== market.target ||
        e.name !==
          (supply && (provider === 'euler' || provider === 'gearbox')
            ? 'Deposit'
            : supply
              ? 'Supply'
              : 'Withdraw')
      )
        return false;
      if (provider === 'compound')
        return (
          same(e.args[supply ? 'dst' : 'src'], step.wallet) &&
          same(e.args[supply ? 'from' : 'to'], caller)
        );
      if (provider === 'spark')
        return (
          same(e.args.reserve, ETH_USDC) &&
          same(e.args.user, caller) &&
          same(e.args[supply ? 'onBehalfOf' : 'to'], step.wallet)
        );
      if (provider === 'morpho')
        return (
          same(e.args.onBehalf, step.wallet) &&
          same(e.args[supply ? 'caller' : 'receiver'], caller) &&
          same(e.args.id, '0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64')
        );
      return (
        same(e.args.owner, step.wallet) && same(e.args[supply ? 'sender' : 'receiver'], caller)
      );
    });
    const actual = BigInt(String(event?.args.assets ?? event?.args.amount ?? 0));
    if (!event || actual <= 0n || (supply && actual !== amount))
      return fail('The finalized provider deposit or withdrawal was not verified.');
    if (supply) this.ethereum.verifyLendingFee(step, receipt as Record<string, unknown>);
    return {
      usdcAmount: actual.toString(),
      ...(event.args.shares !== undefined ? { receiptTokens: String(event.args.shares) } : {}),
    };
  }
}
