import { randomUUID } from 'node:crypto';
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { encodeFunctionData, maxUint256 } from 'viem';
import { KAMINO_COLLATERAL_MINT, kaminoUsdcSupplyInstructions, kaminoUsdcWithdrawInstructions } from '../../../../onchain/src/destination-lending';
import { SOLANA_USDC } from '../../../../onchain/src/source-plan';
import { BridgeJournal, fingerprint } from './bridge-journal.server';
import { BridgeEthereum } from './bridge-ethereum.server';
import { BridgeSolana } from './bridge-solana.server';
import { missingConfigurationStore, type WalletConfigurationStore } from './wallet-config';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, completedStep, isDirectLendingStep, type BridgeStep, type LocalWalletConfig } from './bridge-types';
import { MAINNET_TEST as P, POOL_ABI, TOKEN_ABI, fail, usdcAmount } from './policy';
import { AdditionalLendingService } from './additional-lending.server';
import { isLendingProvider, MARKETS } from '../lending/markets';
import { lendingFeeEvidence, validateLendingFee } from '../lending/routing-fee';
import { solanaLendingFeeInstructions } from '../lending/solana-fee';
import { routedLendingCall } from '../lending/ethereum-router';

const same = (value: unknown, expected: string) => String(value).toLowerCase() === expected.toLowerCase();

/** Same-chain supplies collect 10 bps atomically; bridge-funded supplies are already charged. */
export class LocalLendingService {
  readonly additional: AdditionalLendingService;
  constructor(readonly journal: BridgeJournal, readonly ethereum: BridgeEthereum, readonly solana: BridgeSolana, readonly configuration: WalletConfigurationStore = missingConfigurationStore) { this.additional = new AdditionalLendingService(journal, ethereum, solana); }

  assertStep(step: BridgeStep, config = this.configuration.read()) {
    if (!isDirectLendingStep(step)) return fail('This is not a USDC lending review.');
    validateLendingFee(step, config);
    if (step.evidence.lendingRouter && step.evidence.lendingRouter !== config.ethereumLendingRouter) return fail('The reviewed lending router changed.');
    if (step.evidence.fundingBridgeId) {
      const bridge = this.journal.bridge(step.evidence.fundingBridgeId);
      if (!['MINTED', 'LENT'].includes(bridge.status) || bridge.destinationProvider !== step.evidence.provider || bridge.received !== (step.evidence.lendAmount ?? step.evidence.amount)) return fail('The bridge-funded deposit could not be verified.');
    }
    const wallet = step.network === BRIDGE_ETHEREUM ? config.ethereumWallet : step.network === BRIDGE_SOLANA ? config.solanaWallet : null;
    if (!wallet || step.wallet !== wallet) return fail('Reconnect the wallet used for this lending transaction.');
    if (step.evidence.provider && (!isLendingProvider(step.evidence.provider) || MARKETS[step.evidence.provider].network !== step.network)) return fail('The reviewed provider does not match this network.');
    if (step.fingerprint !== fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence })) return fail('The lending transaction changed after preparation.');
    return step;
  }

  async prepare(config: LocalWalletConfig, network: unknown, action: unknown, amount: unknown, smartEvidence: Record<string, string> = {}, provider?: unknown) {
    if (network !== BRIDGE_ETHEREUM && network !== BRIDGE_SOLANA) return fail('Choose Ethereum or Solana.');
    if (action !== 'supply' && action !== 'withdraw') return fail('Choose lend or withdraw.');
    const wallet = network === BRIDGE_ETHEREUM ? config.ethereumWallet : config.solanaWallet;
    if (!wallet) return fail(`Connect a ${network === BRIDGE_ETHEREUM ? 'Ethereum' : 'Solana'} wallet first.`);
    if (action === 'supply' && this.journal.paused()) return fail('New deposits are paused. Withdrawals remain available.');
    const activeBridge = this.journal.bridges().find((bridge) => !['LENT', 'SOURCE_FAILED', 'CANCELLED'].includes(bridge.status));
    if (activeBridge && (smartEvidence.fundingBridgeId !== activeBridge.id || activeBridge.status !== 'MINTED' || provider !== activeBridge.destinationProvider || action !== 'supply' || usdcAmount(amount).toString() !== activeBridge.received)) return fail('Finish or recover the current bridge before starting a direct lending transaction.');
    if (this.journal.steps().some((step) => step.wallet === wallet && !completedStep(step.state))) return fail('Finish or cancel the current wallet transaction before preparing another.');
    const principal = action === 'supply' ? usdcAmount(amount) : 0n;
    if (action === 'withdraw' && amount !== 'all') return fail('Review the full lending position before withdrawing it.');
    if (provider !== undefined && (!isLendingProvider(provider) || MARKETS[provider].network !== network)) return fail('Choose a lending provider on the selected network.');
    if (smartEvidence.fundingBridgeId && !activeBridge) return fail('The bridge-funded deposit is no longer available.');
    const routed = action === 'supply' && !smartEvidence.fundingBridgeId;
    if (network === BRIDGE_ETHEREUM && routed && !config.ethereumLendingRouter) {
      const call = this.ethereum.lendingDeploymentCall(config), prepared = await this.ethereum.prepare(call, 'DEPLOY_LENDING'), now = Date.now();
      const step: BridgeStep = { id: randomUUID(), bridgeId: null, kind: 'DEPLOY_LENDING', network, wallet, state: 'PREPARED', createdAt: now,
        expiresAt: now + 120_000, fingerprint: '', transactionId: null, ethereum: prepared.transaction, solana: null,
        maxNetworkCost: prepared.cost, sourcePrincipal: '0', evidence: { ...smartEvidence, provider: String(provider ?? 'aave'), asset: 'USDC', action,
          amount: principal.toString(), lendAmount: principal.toString(), ...lendingFeeEvidence(config, network, action, principal, false), config: JSON.stringify(config) } };
      step.fingerprint = fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence });
      return this.journal.createStep(step);
    }
    if (isLendingProvider(provider) && provider !== 'aave' && provider !== 'kamino') return this.additional.prepare(config, provider, action, principal, smartEvidence);
    const now = Date.now();
    const step: BridgeStep = { id: randomUUID(), bridgeId: null, kind: action === 'supply' ? 'LENDING_SUPPLY' : 'LENDING_WITHDRAW', network, wallet,
      state: 'PREPARED', createdAt: now, expiresAt: now + 120_000, fingerprint: '', transactionId: null, ethereum: null, solana: null,
      maxNetworkCost: '0', sourcePrincipal: principal.toString(), evidence: { ...smartEvidence, provider: network === BRIDGE_ETHEREUM ? 'aave' : 'kamino', asset: 'USDC', action, amount: principal.toString(), ...lendingFeeEvidence(config, network, action, principal, !routed) } };
    const platformFee = BigInt(step.evidence.platformFee!), totalDebit = principal + platformFee;
    if (network === BRIDGE_ETHEREUM) {
      if (!config.ethereumWallet) return fail('Connect an Ethereum wallet first.');
      const checked = await this.ethereum.rpc.inspect(config.ethereumWallet), balance = checked.snapshot;
      if (!checked.active || checked.paused || action === 'supply' && checked.frozen) return fail('Aave is not accepting this operation for USDC.');
      if (BigInt(balance.totalDebt) !== 0n) return fail('Use an Ethereum wallet with no Aave borrowing debt for this local test.');
      step.evidence.market = 'Aave V3'; step.evidence.positionBefore = balance.supplied;
      let to = P.pool, data;
      if (action === 'supply') {
        if (routed) await this.ethereum.validateLendingRouter(config);
        const spender = routed ? config.ethereumLendingRouter! : P.pool;
        const allowance = routed ? await this.ethereum.allowance(config.ethereumWallet, spender) : BigInt(balance.allowance);
        if (routed) step.evidence.lendingRouter = spender;
        if (BigInt(balance.usdc) < totalDebit) return fail('The Ethereum wallet needs the deposit amount plus its routing fee.');
        if (allowance !== totalDebit) {
          const approval = allowance === 0n ? totalDebit : 0n;
          step.kind = approval === 0n ? 'LENDING_REVOKE' : 'LENDING_APPROVAL'; step.sourcePrincipal = '0';
          step.evidence = { ...step.evidence, amount: approval.toString(), lendAmount: principal.toString(), spender };
          to = P.usdc; data = encodeFunctionData({ abi: TOKEN_ABI, functionName: 'approve', args: [spender, approval] });
        } else if (routed) ({ to, data } = routedLendingCall(spender, 'aave', principal));
        else data = encodeFunctionData({ abi: POOL_ABI, functionName: 'supply', args: [P.usdc, principal, config.ethereumWallet, 0] });
      } else {
        if (BigInt(balance.supplied) <= 0n) return fail('This wallet has no supplied Aave USDC to withdraw.');
        step.evidence.amount = balance.supplied; step.evidence.withdrawAll = 'true';
        data = encodeFunctionData({ abi: POOL_ABI, functionName: 'withdraw', args: [P.usdc, maxUint256, config.ethereumWallet] });
      }
      const prepared = await this.ethereum.prepare({ from: config.ethereumWallet, to, data }, step.kind);
      step.ethereum = prepared.transaction; step.maxNetworkCost = prepared.cost; step.expiresAt = Date.now() + 120_000;
    } else {
      if (!config.solanaWallet) return fail('Connect a Solana wallet first.');
      const checked = await this.solana.inspect({ solanaWallet: config.solanaWallet, solanaTreasury: config.solanaTreasury });
      if (action === 'supply' && BigInt(checked.usdc) < totalDebit) return fail('The Solana wallet needs the deposit amount plus its routing fee.');
      if (action === 'withdraw' && BigInt(checked.collateral) <= 0n) return fail('This wallet has no Kamino USDC receipt tokens to redeem.');
      const user = new PublicKey(config.solanaWallet), lifetime = await this.solana.blockhash(checked.slot);
      const instructions = action === 'supply' ? kaminoUsdcSupplyInstructions({ user, principal }) : kaminoUsdcWithdrawInstructions({ user, collateralAmount: BigInt(checked.collateral) });
      const feeAccount = platformFee > 0n ? await this.solana.routingFeeAccount(config.solanaTreasury, checked.slot) : null;
      const fee = feeAccount ? { treasury: config.solanaTreasury, balance: feeAccount.balance, amount: platformFee } : undefined;
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user, recentBlockhash: lifetime.blockhash,
        // An explicit zero price preserves the reviewed network fee. Phantom may
        // insert its own price during signing when only a compute limit is present.
        instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
          ...instructions, ...solanaLendingFeeInstructions(user, config.solanaTreasury, platformFee)] }).compileToV0Message());
      const serialized = Buffer.from(tx.serialize()).toString('base64');
      const cost = await this.solana.lendingCost(config.solanaWallet, action, checked.slot, serialized) + (feeAccount?.rent ?? 0n);
      if (BigInt(checked.lamports) < cost) return fail(`This transaction needs ${Number(cost) / 1e9} SOL for its network fee and any new token account.`);
      const projected = await this.solana.simulate(serialized, lifetime.lastValidBlockHeight, lifetime.contextSlot, config.solanaWallet, fee);
      if (!projected) return fail('The lending balance preview is unavailable.');
      const projectedDebit = BigInt(checked.usdc) - BigInt(projected.usdc);
      // Kamino rounds the actual debit down to the amount represented by whole cToken units.
      if (action === 'supply' ? projectedDebit <= platformFee || projectedDebit > totalDebit || BigInt(projected.collateral) <= BigInt(checked.collateral)
        : BigInt(projected.collateral) !== 0n || BigInt(projected.usdc) <= BigInt(checked.usdc)) return fail('The simulated lending balances changed. Refresh and review again.');
      step.evidence.market = 'Kamino';
      if (action === 'supply') { step.evidence.expectedDebit = (projectedDebit - platformFee).toString(); step.evidence.expectedTotalDebit = projectedDebit.toString(); }
      step.evidence.expectedReceived = (action === 'supply' ? BigInt(projected.collateral) - BigInt(checked.collateral) : BigInt(projected.usdc) - BigInt(checked.usdc)).toString();
      if (action === 'withdraw') { step.evidence.amount = step.evidence.expectedReceived; step.evidence.collateralAmount = checked.collateral; step.evidence.withdrawAll = 'true'; }
      step.solana = { serialized, message: Buffer.from(tx.message.serialize()).toString('base64'), version: 0,
        lastValidBlockHeight: lifetime.lastValidBlockHeight, contextSlot: lifetime.contextSlot };
      step.maxNetworkCost = cost.toString(); step.expiresAt = Date.now() + 120_000;
    }
    step.fingerprint = fingerprint({ ethereum: step.ethereum, solana: step.solana, evidence: step.evidence });
    return this.journal.createStep(step);
  }

  async reserve(id: string) {
    let step = this.assertStep(this.journal.step(id));
    if (step.state !== 'PREPARED' || step.expiresAt <= Date.now()) return fail('This lending review expired or was already submitted.');
    const config = this.configuration.read();
    validateLendingFee(step, config, true);
    if (step.solana) {
      // Rate checks and time spent reading the review can exhaust the original blockhash.
      // Refresh only the unsigned message's lifetime, then recheck balances and simulate it.
      const lifetime = await this.solana.blockhash(step.solana.contextSlot);
      const transaction = VersionedTransaction.deserialize(Buffer.from(step.solana.serialized, 'base64'));
      transaction.message.recentBlockhash = lifetime.blockhash;
      step = { ...step, solana: { ...step.solana, serialized: Buffer.from(transaction.serialize()).toString('base64'),
        message: Buffer.from(transaction.message.serialize()).toString('base64'),
        lastValidBlockHeight: lifetime.lastValidBlockHeight, contextSlot: lifetime.contextSlot } };
    }
    if (step.kind === 'DEPLOY_LENDING') {
      if (config.ethereumLendingRouter || step.ethereum!.data !== this.ethereum.lendingDeploymentCall(config).data) return fail('The lending setup changed. Review again.');
      await this.ethereum.revalidate(step);
      return this.journal.reserveStep(id);
    }
    if (step.evidence.lendingRouter) await this.ethereum.validateLendingRouter(config);
    if (step.evidence.provider && step.evidence.provider !== 'aave' && step.evidence.provider !== 'kamino') return this.additional.reserve(step);
    if (step.network === BRIDGE_ETHEREUM) {
      const checked = await this.ethereum.rpc.inspect(step.ethereum!.from), balance = checked.snapshot;
      if (!checked.active || checked.paused || step.kind !== 'LENDING_WITHDRAW' && checked.frozen) return fail('Aave is not accepting this operation for USDC.');
      if (step.kind === 'LENDING_SUPPLY' && (BigInt(balance.usdc) < BigInt(step.evidence.totalSourceDebit ?? step.evidence.amount!) ||
        (step.evidence.lendingRouter ? String(await this.ethereum.allowance(step.ethereum!.from, config.ethereumLendingRouter!)) : balance.allowance) !== (step.evidence.totalSourceDebit ?? step.evidence.amount))) return fail('The USDC balance, lending allowance, or position changed. Review the deposit again.');
      if (step.kind === 'LENDING_WITHDRAW' && BigInt(balance.supplied) < BigInt(step.evidence.amount!)) return fail('The supplied Aave balance changed. Review the withdrawal again.');
      await this.ethereum.revalidate(step);
    } else {
      const checked = await this.solana.inspect({ solanaWallet: step.wallet, solanaTreasury: config.solanaTreasury });
      const feeAmount = BigInt(step.evidence.platformFee!);
      const feeAccount = feeAmount > 0n ? await this.solana.routingFeeAccount(config.solanaTreasury, checked.slot) : null;
      const cost = await this.solana.lendingCost(step.wallet, step.kind === 'LENDING_SUPPLY' ? 'supply' : 'withdraw', checked.slot, step.solana!.serialized) + (feeAccount?.rent ?? 0n);
      if (cost > BigInt(step.maxNetworkCost) || BigInt(checked.lamports) < cost || (step.kind === 'LENDING_SUPPLY' ? BigInt(checked.usdc) < BigInt(step.evidence.totalSourceDebit!) : checked.collateral !== step.evidence.collateralAmount)) return fail('The Solana balance or transaction cost changed. Review the transaction again.');
      await this.solana.simulate(step.solana!.serialized, step.solana!.lastValidBlockHeight, step.solana!.contextSlot, step.wallet,
        feeAccount ? { treasury: config.solanaTreasury, balance: feeAccount.balance, amount: feeAmount } : undefined);
    }
    return this.journal.reserveStep(id, Date.now(), step.solana);
  }

  async reconcile(id: string) {
    const step = this.assertStep(this.journal.step(id));
    if (!step.transactionId || ['PREPARED', 'CANCELLED', 'REJECTED'].includes(step.state)) return step;
    const result = step.network === BRIDGE_ETHEREUM ? await this.ethereum.receipt(step, step.transactionId) : await this.solana.receipt(step, step.transactionId);
    if (result.state !== 'FINALIZED' && result.state !== 'FAILED') {
      if (completedStep(step.state)) return fail('Previously finalized lending evidence is unavailable. Investigate the original transaction.');
      if (step.network === BRIDGE_SOLANA && await this.solana.expiredSignedRequest(step)) {
        return this.journal.changeStep(id, ['SIGNED', 'SUBMITTED'], { state: 'CANCELLED', walletError: '' });
      }
      return this.journal.changeStep(id, ['RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'], { state: result.state });
    }
    if (result.state === 'FAILED') return step.state === 'FAILED' ? step : this.journal.changeStep(id, ['RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'], { state: 'FAILED' });
    if (step.kind === 'DEPLOY_LENDING') {
      if (!('contractAddress' in result) || !result.contractAddress) return fail('The lending setup address was not verified.');
      const current = this.configuration.read(), original = JSON.parse(step.evidence.config!) as LocalWalletConfig;
      if (current.ethereumWallet !== original.ethereumWallet || current.ethereumTreasury !== original.ethereumTreasury || current.ethereumLendingRouter && current.ethereumLendingRouter !== result.contractAddress) return fail('Restore the reviewed lending setup configuration.');
      const next = { ...current, ethereumLendingRouter: result.contractAddress };
      await this.ethereum.validateLendingRouter(next); this.configuration.write(next);
      return step.state === 'FINALIZED' ? step : this.journal.changeStep(id, ['RESERVED', 'SUBMITTED', 'CONFIRMED'], { state: 'FINALIZED' });
    }
    let outcome: BridgeStep['outcome'];
    if (step.evidence.provider && step.evidence.provider !== 'aave' && step.evidence.provider !== 'kamino') {
      outcome = await this.additional.verify(step, result.receipt);
      if (step.kind === 'LENDING_SUPPLY' && step.evidence.fundingBridgeId) {
        const bridge = this.journal.bridge(step.evidence.fundingBridgeId);
        if (bridge.destinationProvider !== step.evidence.provider || bridge.received !== step.evidence.amount) return fail('The bridged lending destination changed.');
        if (bridge.status === 'MINTED') this.journal.updateBridge({ ...bridge, status: 'LENT' });
        else if (bridge.status !== 'LENT') return fail('The bridged lending state changed.');
      }
      return step.state === 'FINALIZED' ? step : this.journal.changeStep(id, ['RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'], { state: 'FINALIZED', outcome });
    }
    if (step.network === BRIDGE_ETHEREUM) {
      const receipt = result.receipt as Record<string, unknown>, events = this.ethereum.events(receipt), amount = BigInt(step.evidence.amount!);
      if (step.kind === 'LENDING_APPROVAL' || step.kind === 'LENDING_REVOKE') {
        if (!events.some((e) => e.address === P.usdc && e.name === 'Approval' && same(e.args.owner, step.wallet) && same(e.args.spender, step.evidence.spender ?? P.pool) && e.args.value === amount)) return fail('The exact lending USDC approval was not verified.');
      } else if (step.kind === 'LENDING_SUPPLY') {
        if (!events.some((e) => e.address === P.pool && e.name === 'Supply' && same(e.args.reserve, P.usdc) && same(e.args.user, step.evidence.lendingRouter ?? step.wallet) && same(e.args.onBehalfOf, step.wallet) && e.args.amount === amount)) return fail('The finalized lending deposit was not verified.');
        this.ethereum.verifyLendingFee(step, receipt);
        const position = BigInt(await this.ethereum.call(P.aToken, encodeFunctionData({ abi: TOKEN_ABI, functionName: 'balanceOf', args: [step.ethereum!.from] }), { blockHash: receipt.blockHash, requireCanonical: true }));
        if (position + 1n < BigInt(step.evidence.positionBefore!) + amount) return fail('The supplied aUSDC balance was not verified.');
        outcome = { usdcAmount: amount.toString() };
      } else {
        const withdrawal = events.find((e) => e.address === P.pool && e.name === 'Withdraw' && same(e.args.reserve, P.usdc) && same(e.args.user, step.wallet) && same(e.args.to, step.wallet) && BigInt(String(e.args.amount)) >= amount);
        if (!withdrawal || !events.some((e) => e.address === P.usdc && e.name === 'Transfer' && same(e.args.from, P.aToken) && same(e.args.to, step.wallet) && e.args.value === withdrawal.args.amount)) return fail('The withdrawal back to your Ethereum wallet was not verified.');
        outcome = { usdcAmount: String(withdrawal.args.amount) };
      }
    } else {
      const meta = (result.receipt as { meta: unknown }).meta;
      const usdc = this.solana.tokenChange(meta, step.wallet, SOLANA_USDC.toBase58()), collateral = this.solana.tokenChange(meta, step.wallet, KAMINO_COLLATERAL_MINT.toBase58());
      const fee = BigInt(step.evidence.platformFee!);
      if (fee > 0n && this.solana.tokenChange(meta, step.evidence.feeTreasury!, SOLANA_USDC.toBase58()) !== fee) return fail('The finalized routing fee did not reach the treasury.');
      if (step.kind === 'LENDING_SUPPLY' ? usdc >= -fee || -usdc > BigInt(step.evidence.amount!) + fee || collateral <= 0n : usdc <= 0n || collateral !== -BigInt(step.evidence.collateralAmount!)) return fail('The finalized lending USDC and receipt-token changes were not verified.');
      outcome = { usdcAmount: (usdc < 0n ? -usdc - fee : usdc).toString(), receiptTokens: (collateral < 0n ? -collateral : collateral).toString() };
    }
    return step.state === 'FINALIZED' ? step : this.journal.changeStep(id, ['RESERVED', 'SIGNED', 'SUBMITTED', 'CONFIRMED'], { state: 'FINALIZED', ...(outcome ? { outcome } : {}) });
  }
}
