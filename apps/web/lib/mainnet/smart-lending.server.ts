import { randomUUID } from 'node:crypto';
import { calculateFeeAwareReturn, compareFeeAwareReturns, type FeeAwareAllocationCostsUsdMantissa, type FeeAwareCandidateCalculation } from '../../../api/src/smart-lending/domain/fee-aware-return';
import { lendingRoutingFee, SAME_CHAIN_LENDING_FEE_BPS, BRIDGE_LENDING_FEE_BPS } from '../../../../onchain/src/lending-fee';
import { getCircleStandardFee } from '../../../../onchain/src/circle-client';
import type { SmartLendingInput, SmartLendingQuote, SmartLendingRoute, LendingMarketView } from '../lending/smart-lending';
import type { LocalBridgeService } from './bridge-service.server';
import { fingerprint } from './bridge-journal.server';
import { LendingRateReader, type LendingRate } from './lending-rates.server';
import { BRIDGE_ETHEREUM as ETH, BRIDGE_SOLANA as SOL, hasBothWallets, type LocalWalletConfig } from './bridge-types';
import { MAINNET_TEST, fail, usdcAmount } from './policy';

import { LENDING_PROVIDERS, MARKETS } from '../lending/markets';
import { isAdditionalSolana } from './solana-markets.server';

const USD = 10n ** 18n;
const zeroCosts = (): FeeAwareAllocationCostsUsdMantissa => ({ entrySourceNetwork: 0n, entrySourceSwap: 0n, entryBridge: 0n,
  entryDestinationNetwork: 0n, entryDestinationSwap: 0n, providerEntry: 0n, providerExit: 0n, exitDestinationNetwork: 0n,
  exitDestinationSwap: 0n, exitBridge: 0n, exitSourceNetwork: 0n, platformRouting: 0n, riskBuffer: 0n });
type StoredQuote = SmartLendingQuote & { configFingerprint: string };
type AssessedRoute = { id: SmartLendingRoute['id']; routeKind: 'SAME_CHAIN' | 'CROSS_CHAIN'; calculation: FeeAwareCandidateCalculation | null; view: SmartLendingRoute };
const message = (error: unknown) => error instanceof Error ? error.message : 'The live market check did not complete.';

function unavailableReason(routes: AssessedRoute[], network: typeof ETH | typeof SOL): string {
  const sameChain = routes.filter((route) => route.routeKind === 'SAME_CHAIN');
  const eligible = sameChain.filter((route) => route.calculation && route.view.reasons.length === 0);
  if (eligible.length) {
    if (eligible.every((route) => route.view.fundingReasons.includes('The source wallet needs more USDC for this amount.'))) return 'Your source wallet does not have enough USDC for this deposit. Choose an amount within your available balance.';
    if (eligible.every((route) => route.view.fundingReasons.some((reason) => reason.includes('needs more SOL') || reason.includes('needs more ETH')))) return network === SOL
      ? 'Your Solana wallet needs more SOL for the transaction fee and any new account rent. Your USDC amount does not cover these costs.'
      : 'Your Ethereum wallet needs more ETH for the deposit transaction fees.';
    return 'Your wallet balance or existing lending position could not pass the deposit checks. Refresh your live wallet balances before trying again.';
  }
  if (sameChain.every((route) => route.view.reasons.includes('This amount exceeds the market’s remaining deposit capacity.'))) return 'The available lending markets do not currently have enough deposit capacity for this amount. Try a smaller amount or refresh later.';
  if (sameChain.every((route) => route.view.reasons.includes('Current Ethereum gas exceeds the transaction fee budget.'))) return 'Current Ethereum gas exceeds the transaction fee budget. Refresh when network fees are lower.';
  if (sameChain.every((route) => route.view.reasons.includes('This USDC market is paused, frozen, or unavailable.'))) return 'Deposits are currently unavailable in the supported markets on this network. Refresh later.';
  return 'Live wallet or market checks could not be completed. Refresh your live wallet balances and try again.';
}

export function parseSmartLendingInput(value: unknown): SmartLendingInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('Enter a lending amount and holding period.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'amount,holdingDays,includeCrossChain,sourceNetwork' ||
    input.sourceNetwork !== ETH && input.sourceNetwork !== SOL || typeof input.includeCrossChain !== 'boolean' ||
    !Number.isInteger(input.holdingDays) || Number(input.holdingDays) < 1 || Number(input.holdingDays) > 3650) return fail('Choose a mainnet wallet and a holding period from 1 to 3650 days.');
  usdcAmount(input.amount);
  return input as unknown as SmartLendingInput;
}

/** Shared production and local route comparison. Quotes never sign or broadcast. */
export class LocalSmartLendingService {
  readonly rates: LendingRateReader;
  private marketRead: { config: string; promise: ReturnType<LocalSmartLendingService['readMarketData']>; expiresAt: number | null } | undefined;
  constructor(readonly bridge: LocalBridgeService) { this.rates = new LendingRateReader(bridge.ethereum); }

  invalidateMarketData() { this.marketRead = undefined; }
  async marketData(config: LocalWalletConfig, fresh = false) {
    const key = fingerprint(config);
    if (this.marketRead?.config === key && (this.marketRead.expiresAt === null || !fresh && this.marketRead.expiresAt > Date.now())) return this.marketRead.promise;
    const promise = this.readMarketData(config);
    const entry = { config: key, promise, expiresAt: null as number | null };
    this.marketRead = entry;
    try {
      const value = await promise;
      entry.expiresAt = Date.now() + (value.results.every((result) => result.status === 'fulfilled') ? 30_000 : 5_000);
      return value;
    } catch (error) { if (this.marketRead === entry) this.marketRead = undefined; throw error; }
  }
  private async readMarketData(config: LocalWalletConfig) {
    const base = Promise.allSettled([
      this.rates.aave(), this.rates.kamino(),
      config.ethereumWallet ? this.bridge.ethereum.rpc.inspect(config.ethereumWallet) : Promise.resolve(null),
      config.solanaWallet ? this.bridge.solana.inspect({ solanaWallet: config.solanaWallet, solanaTreasury: config.solanaTreasury }) : Promise.resolve(null),
    ]);
    // Independent provider reads start together; oracle prices are only needed
    // when assembling the result, not before contacting every other market.
    const providers = Promise.allSettled(LENDING_PROVIDERS.map(async (id) => {
      if (id === 'aave' || id === 'kamino') return null;
      const state = isAdditionalSolana(id) ? await this.bridge.lending.additional.solanaMarkets.read(id, config.solanaWallet ?? undefined)
        : await this.bridge.lending.additional.ethereumMarkets.read(id, config.ethereumWallet ?? undefined);
      const cost = isAdditionalSolana(state.provider) && 'nativeBalance' in state ? await this.bridge.lending.additional.solanaMarkets.depositCost(state) : null;
      return { state, cost };
    }));
    const [[aave, kamino, ethWallet, solWallet], providerResults] = await Promise.all([base, providers]);
    const results = await Promise.allSettled(LENDING_PROVIDERS.map(async (id, index) => {
      const price = MARKETS[id].network === ETH ? aave : kamino;
      if (price.status !== 'fulfilled') throw price.reason;
      if (id === 'aave') {
        const state = ethWallet.status === 'fulfilled' ? ethWallet.value : null;
        return { rate: price.value, allowance: state?.snapshot.allowance ?? '0', debt: state?.snapshot.totalDebt ?? '0', cost: null as bigint | null,
          supplied: state?.snapshot.supplied ?? null, shares: state?.snapshot.supplied ?? null };
      }
      if (id === 'kamino') {
        const state = solWallet.status === 'fulfilled' ? solWallet.value : null;
        const cost = state && config.solanaWallet ? await this.bridge.solana.lendingCost(config.solanaWallet, 'supply', state.slot) : null;
        return { rate: price.value, allowance: '0', debt: '0', cost, supplied: state?.supplied ?? null, shares: state?.collateral ?? null,
          receiptExchangeRate: state?.receiptExchangeRate ?? null };
      }
      const result = providerResults[index]!;
      if (result.status === 'rejected') throw result.reason;
      const { state, cost } = result.value!;
      const rate: LendingRate = { ...price.value, provider: id, name: MARKETS[id].name, network: MARKETS[id].network, source: MARKETS[id].source,
        observedAt: state.observedAt, apyBasisPoints: state.apyBasisPoints, available: state.available, capacityAtomic: state.capacity?.toString() ?? null,
        evidence: state.binding };
      return { rate, allowance: 'allowance' in state ? state.allowance.toString() : '0', debt: 'debt' in state ? state.debt.toString() : '0', cost,
        supplied: state.supplied.toString(), shares: state.shares.toString(), withdrawalFeeBps: 'withdrawalFeeBps' in state ? state.withdrawalFeeBps : 0n };
    }));
    return { aave, kamino, ethWallet, solWallet, results };
  }
  async markets(config: LocalWalletConfig): Promise<LendingMarketView[]> {
    const { results } = await this.marketData(config);
    return results.map((result, index) => result.status === 'fulfilled' ? { id: LENDING_PROVIDERS[index]!,
      apyBasisPoints: result.value.rate.apyBasisPoints, observedAt: result.value.rate.observedAt, supplied: result.value.supplied, shares: result.value.shares,
      capacity: result.value.rate.capacityAtomic, available: result.value.rate.available, entryCostNative: result.value.cost?.toString() ?? null,
      ...('receiptExchangeRate' in result.value ? { receiptExchangeRate: result.value.receiptExchangeRate } : {}), error: null }
      : { id: LENDING_PROVIDERS[index]!, apyBasisPoints: null, observedAt: null, supplied: null, shares: null, capacity: null, available: false, entryCostNative: null, error: message(result.reason) });
  }

  async compare(config: LocalWalletConfig, value: unknown, fresh = true): Promise<SmartLendingQuote> {
    const input = parseSmartLendingInput(value), principal = usdcAmount(input.amount), now = Date.now();
    const sourceWallet = input.sourceNetwork === ETH ? config.ethereumWallet : config.solanaWallet;
    if (!sourceWallet) return fail('Connect the wallet that holds the USDC you want to lend.');
    const { aave, kamino, ethWallet, solWallet, results } = await this.marketData(config, fresh);
    const eth = ethWallet.status === 'fulfilled' ? ethWallet.value : null;
    const sol = solWallet.status === 'fulfilled' ? solWallet.value : null;
    const sourceRate = input.sourceNetwork === ETH ? aave : kamino;
    let feeAccountRent = 0n, feeCheckError = '', routerAllowance = 0n;
    try {
      if (input.sourceNetwork === SOL && sol && lendingRoutingFee(principal) > 0n) feeAccountRent = (await this.bridge.solana.routingFeeAccount(config.solanaTreasury, sol.slot)).rent;
      if (input.sourceNetwork === ETH && config.ethereumWallet && config.ethereumLendingRouter) routerAllowance = await this.bridge.ethereum.allowance(config.ethereumWallet, config.ethereumLendingRouter);
    } catch (error) { feeCheckError = message(error); }
    let bridgeError = '', entryBridgeFee = 0n, exitBridgeFee = 0n;
    if (input.includeCrossChain && hasBothWallets(config)) {
      if (!config.ethereumSourceRouter || !config.ethereumSupplyRouter) bridgeError = 'Complete the bridge router setup to use this route.';
      else {
        try {
          await Promise.all([this.bridge.ethereum.validateRouter(config, 'DEPLOY_SOURCE'), this.bridge.ethereum.validateRouter(config, 'DEPLOY_SUPPLY')]);
          [entryBridgeFee, exitBridgeFee] = await Promise.all([
            getCircleStandardFee({ sourceNetwork: input.sourceNetwork, principal }),
            getCircleStandardFee({ sourceNetwork: input.sourceNetwork === ETH ? SOL : ETH, principal }),
          ]);
          if (sol) {
            const solMinimum = (principal * BigInt(sol.minimumFeeBps) + 9999n) / 10000n;
            if (input.sourceNetwork === SOL && solMinimum > entryBridgeFee) entryBridgeFee = solMinimum;
            if (input.sourceNetwork === ETH && solMinimum > exitBridgeFee) exitBridgeFee = solMinimum;
          }
          if (entryBridgeFee * 100n > principal || exitBridgeFee * 100n > principal) bridgeError = 'Circle fees currently exceed the bridge fee budget.';
        } catch (error) { bridgeError = message(error); }
      }
    }
    const assessed: AssessedRoute[] = results.map((result, index) => {
      const id = LENDING_PROVIDERS[index]!, network = MARKETS[id].network;
      const routeKind = network === input.sourceNetwork ? 'SAME_CHAIN' : 'CROSS_CHAIN';
      const view: SmartLendingRoute = { id, network, name: MARKETS[id].name, market: MARKETS[id].market, routeKind, apyBasisPoints: null,
        observedAt: null, source: '', entryCostUsd: null, exitCostUsd: null, projectedYieldUsd: null, netBenefitUsd: null, breakEvenDays: null, reasons: [], fundingReasons: [] };
      const row: AssessedRoute = { id, routeKind, calculation: null, view };
      if (result.status === 'rejected') { view.reasons.push(message(result.reason)); return row; }
      const { rate, cost: solCost } = result.value;
      view.apyBasisPoints = rate.apyBasisPoints; view.observedAt = rate.observedAt; view.source = rate.source;
      if (Date.now() - rate.observedAt > 120_000 || rate.observedAt > Date.now() + 15_000) view.reasons.push('The market rate is stale. Compare again.');
      if (!rate.available) view.reasons.push('This USDC market is paused, frozen, or unavailable.');
      if (rate.capacityAtomic !== null && principal > BigInt(rate.capacityAtomic)) view.reasons.push('This amount exceeds the market’s remaining deposit capacity.');
      if (sourceRate.status !== 'fulfilled') { view.reasons.push('The source USDC valuation is unavailable.'); return row; }
      const usdcPrice = BigInt(sourceRate.value.usdcPriceUsd);
      if (routeKind === 'CROSS_CHAIN') {
        if (!input.includeCrossChain) view.reasons.push('Cross-chain routing is off.');
        if (!hasBothWallets(config)) view.reasons.push('Connect both wallets to use this route.');
        if (bridgeError) view.reasons.push(bridgeError);
      }
      const sourceResult = input.sourceNetwork === ETH ? ethWallet : solWallet;
      const sourceBalance = input.sourceNetwork === ETH ? eth?.snapshot.usdc : sol?.usdc;
      if (sourceResult.status === 'rejected') view.fundingReasons.push(message(sourceResult.reason));
      const feeBasisPoints = routeKind === 'CROSS_CHAIN' ? BRIDGE_LENDING_FEE_BPS : SAME_CHAIN_LENDING_FEE_BPS;
      const platformFee = lendingRoutingFee(principal, feeBasisPoints);
      view.routingFee = { basisPoints: feeBasisPoints, depositUsdc: platformFee.toString(), estimatedReturnUsdc: routeKind === 'CROSS_CHAIN' ? platformFee.toString() : '0', totalSourceDebitUsdc: (principal + platformFee).toString() };
      if (!sourceBalance || BigInt(sourceBalance) < principal + platformFee) view.fundingReasons.push('The source wallet needs more USDC for this amount.');
      if (network === ETH && eth && (!eth.active || eth.frozen || eth.paused || BigInt(eth.snapshot.totalDebt) !== 0n)) view.fundingReasons.push('Aave or this wallet’s lending position is not ready for a deposit.');
      let costs = zeroCosts();
      if (routeKind === 'SAME_CHAIN') {
        if (feeCheckError) view.reasons.push(feeCheckError);
        costs = { ...costs, platformRouting: platformFee * usdcPrice / 1_000_000n };
        if (network === ETH) {
          if (!eth || !rate.maxFeePerGas) { view.reasons.push('Ethereum wallet and gas checks are required.'); return row; }
          const fee = BigInt(rate.maxFeePerGas), allowance = routerAllowance;
          const entryGas = (id === 'euler' || id === 'morpho' ? 500_000n : 350_000n) + (allowance === principal + platformFee ? 0n : allowance === 0n ? 75_000n : 150_000n) + (config.ethereumLendingRouter ? 0n : 2_000_000n);
          costs = { ...costs, entrySourceNetwork: entryGas * fee * BigInt(rate.nativePriceUsd) / USD,
            exitSourceNetwork: 200_000n * fee * BigInt(rate.nativePriceUsd) / USD };
          if (fee > 20_000_000_000n) view.reasons.push('Current Ethereum gas exceeds the transaction fee budget.');
          if (BigInt(eth.snapshot.eth) < entryGas * fee + MAINNET_TEST.gasReserve) view.fundingReasons.push('The Ethereum wallet needs more ETH for deposit fees.');
        } else {
          if (!sol || solCost === null) { view.reasons.push('Solana wallet and fee checks are required.'); return row; }
          costs = { ...costs, entrySourceNetwork: (solCost + feeAccountRent) * BigInt(rate.nativePriceUsd) / 1_000_000_000n,
            exitSourceNetwork: 5_000n * BigInt(rate.nativePriceUsd) / 1_000_000_000n };
          if (BigInt(sol.lamports) < solCost + feeAccountRent) view.fundingReasons.push('The Solana wallet needs more SOL for the transaction fee and token-account rent.');
        }
      } else {
        if (aave.status !== 'fulfilled' || kamino.status !== 'fulfilled' || bridgeError || !input.includeCrossChain || !hasBothWallets(config)) return row;
        // Conservative lifecycle budgets cover approvals, burn, mint, lending and
        // Solana account/table creation. Every actual transaction remains capped.
        const ethCost = 2_000_000_000_000_000n * BigInt(aave.value.nativePriceUsd) / USD;
        const solCostUsd = 20_000_000n * BigInt(kamino.value.nativePriceUsd) / 1_000_000_000n;
        const sourceCost = input.sourceNetwork === ETH ? ethCost : solCostUsd;
        const destinationCost = input.sourceNetwork === ETH ? solCostUsd : ethCost;
        costs = { ...costs, entrySourceNetwork: sourceCost * 3n, entryDestinationNetwork: destinationCost * 4n,
          exitDestinationNetwork: destinationCost * 4n, exitSourceNetwork: sourceCost * 4n,
          entryBridge: entryBridgeFee * usdcPrice / 1_000_000n,
          exitBridge: exitBridgeFee * usdcPrice / 1_000_000n,
          platformRouting: platformFee * usdcPrice / 1_000_000n,
          exitPlatformRouting: platformFee * usdcPrice / 1_000_000n };
        if (!eth || !sol || BigInt(eth.snapshot.eth) < 3_000_000_000_000_000n || BigInt(sol.lamports) < 30_000_000n) view.fundingReasons.push('Both wallets need gas before bridging (0.003 ETH and 0.03 SOL).');
      }
      const withdrawalFee = 'withdrawalFeeBps' in result.value ? result.value.withdrawalFeeBps ?? 0n : 0n;
      costs = { ...costs, providerExit: principal * usdcPrice / 1_000_000n * withdrawalFee / 10_000n };
      const calculated = calculateFeeAwareReturn({ principalUsdMantissa: principal * usdcPrice / 1_000_000n,
        grossApyBasisPoints: BigInt(rate.apyBasisPoints), recurringFeeBasisPoints: 0n, riskPenaltyBasisPoints: 0n,
        holdingPeriodDays: BigInt(input.holdingDays), minimumNetBenefitUsdMantissa: 0n, costs });
      row.calculation = calculated.calculation;
      if (calculated.reasons.includes('NUMERIC_LIMIT_EXCEEDED')) view.reasons.push('This amount exceeds the calculation range.');
      // Profitability ranks fundable deposits; it is not a deposit requirement.
      // Network fees are funded separately, so even costs above the principal
      // remain an estimate to disclose rather than a reason to reject a route.
      const c = calculated.calculation;
      if (c) { view.entryCostUsd = c.entryCostUsdMantissa.toString(); view.exitCostUsd = c.anticipatedExitCostUsdMantissa.toString();
        view.projectedYieldUsd = c.projectedConservativeYieldUsdMantissa.toString(); view.netBenefitUsd = c.netBenefitUsdMantissa.toString(); view.breakEvenDays = c.breakEvenDays?.toString() ?? null; }
      return row;
    });
    const baseline = assessed.filter((row) => row.routeKind === 'SAME_CHAIN' && row.calculation && row.view.reasons.length === 0).sort(compareFeeAwareReturns)[0]?.calculation;
    for (const row of assessed.filter((row) => row.routeKind === 'CROSS_CHAIN' && row.calculation)) {
      if (!baseline) row.view.reasons.push('No eligible same-chain route is available for comparison.');
      else if (row.calculation!.netBenefitUsdMantissa - baseline.netBenefitUsdMantissa < USD / 100n) row.view.reasons.push('The cross-chain route must improve the estimated net return by at least $0.01.');
    }
    const selected = assessed.filter((row) => row.calculation && row.view.reasons.length === 0 && row.view.fundingReasons.length === 0).sort(compareFeeAwareReturns)[0];
    const quote: StoredQuote = { id: randomUUID(), input, createdAt: now,
      expiresAt: Math.min(now + 120_000, ...assessed.map((row) => (row.view.observedAt ?? now) + 120_000)),
      selectedId: selected?.id ?? null, unavailableReason: selected ? null : unavailableReason(assessed, input.sourceNetwork),
      routes: assessed.map((row) => row.view), configFingerprint: fingerprint(config) };
    this.bridge.journal.db.prepare('INSERT INTO lending_quotes(id,body) VALUES (?,?)').run(quote.id, JSON.stringify(quote));
    return quote;
  }

  read(config: LocalWalletConfig, id: string, allowExpired = false) {
    const result = this.bridge.journal.db.prepare('SELECT body FROM lending_quotes WHERE id=?').get(id);
    if (!result) return fail('This comparison is unavailable. Compare rates again.');
    const quote = JSON.parse(String(result.body)) as StoredQuote;
    if (quote.configFingerprint !== fingerprint(config)) return fail('The connected wallets or treasury setup changed. Compare again.');
    if (!allowExpired && quote.expiresAt <= Date.now()) return fail('This comparison expired. Compare live rates again.');
    return quote;
  }

  async prepare(config: LocalWalletConfig, id: string, allowExpired = false) {
    const previous = this.read(config, id, allowExpired);
    if (!previous.selectedId) return fail('No route is recommended for this amount and holding period.');
    const quote = await this.compare(config, previous.input);
    const selected = quote.routes.find((row) => row.id === quote.selectedId);
    if (!selected || quote.selectedId !== previous.selectedId) return fail('The recommended route changed. Compare rates and review the new route.');
    if (JSON.stringify(selected.routingFee) !== JSON.stringify(previous.routes.find((row) => row.id === previous.selectedId)?.routingFee)) return fail('The routing fee changed. Compare rates and review the current fee.');
    if (selected.fundingReasons.length) return fail(selected.fundingReasons.join(' '));
    if (selected.routeKind === 'CROSS_CHAIN') {
      if (!hasBothWallets(config)) return fail('Connect both wallets before bridging.');
      const bridge = await this.bridge.create(quote.input.sourceNetwork, quote.input.amount, config, quote.id, selected.id);
      return { quote, bridge, step: null };
    }
    const step = await this.bridge.lending.prepare(config, selected.network, 'supply', quote.input.amount,
      { smartQuoteId: quote.id, smartApyBasisPoints: selected.apyBasisPoints!, smartHoldingDays: String(quote.input.holdingDays) }, selected.id);
    return { quote, step, bridge: null };
  }

  async assertCurrent(config: LocalWalletConfig, id: string) {
    const previous = this.read(config, id);
    const fresh = await this.compare(config, previous.input);
    const selected = fresh.routes.find((route) => route.id === fresh.selectedId);
    if (!selected || fresh.selectedId !== previous.selectedId || selected.fundingReasons.length) return fail('Rates, costs, or wallet funding changed. Cancel this review and compare the routes again.');
  }
}
