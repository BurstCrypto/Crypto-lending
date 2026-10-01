import { decodeFunctionResult, encodeFunctionData, parseAbi, type Abi, type Address } from 'viem';
import { KAMINO_USDC_RESERVE, KAMINO_MARKET } from '../../../../onchain/src/destination-lending';
import { SOLANA_USDC } from '../../../../onchain/src/source-plan';
import { BridgeEthereum } from './bridge-ethereum.server';
import { BRIDGE_ETHEREUM, BRIDGE_SOLANA, type BridgeNetwork } from './bridge-types';
import { BINDING_ABI, MAINNET_TEST as P, fail } from './policy';
import { quantity } from './rpc.server';
import type { LendingProvider } from '../lending/markets';

const ABI = parseAbi([
  'function getReserveData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40)',
  'function getReserveCaps(address) view returns (uint256,uint256)',
  'function getPriceOracle() view returns (address)',
  'function getAssetPrice(address) view returns (uint256)',
  'function BASE_CURRENCY_UNIT() view returns (uint256)',
]);
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Address;
export const KAMINO_METRICS_URL = `https://api.kamino.finance/kamino-market/${KAMINO_MARKET}/reserves/metrics`;
const SCALE = 10n ** 18n;
export interface LendingRate {
  network: BridgeNetwork;
  provider: LendingProvider;
  name: string;
  apyBasisPoints: string;
  observedAt: number;
  source: string;
  evidence: string;
  usdcPriceUsd: string;
  nativePriceUsd: string;
  maxFeePerGas?: string;
  capacityAtomic: string | null;
  available: boolean;
}

export function decimalMantissa(value: unknown, decimals = 18): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,25})(?:\.\d{1,40})?$/.test(value))
    return fail('A market returned an invalid decimal value.');
  const [whole, fraction = ''] = value.split('.');
  return (
    BigInt(whole!) * 10n ** BigInt(decimals) +
    BigInt(fraction.slice(0, decimals).padEnd(decimals, '0') || '0')
  );
}
function price(value: bigint) {
  if (value <= 0n || value > 1_000_000n * SCALE) return fail('The market price is unavailable.');
  return value.toString();
}

/** Aave's on-chain supply rate is APR in ray units. Match its displayed APY conversion.
 * https://github.com/aave/protocol-subgraphs#why-does-the-raw-subgraph-data-not-match-appaavecom
 */
export function aaveApyBasisPoints(liquidityRate: bigint) {
  if (liquidityRate < 0n || liquidityRate > 10n ** 28n)
    return fail('Aave returned an invalid supply rate.');
  const apy = Math.expm1(31_536_000 * Math.log1p(Number(liquidityRate) / 1e27 / 31_536_000));
  if (!Number.isFinite(apy) || apy > 100) return fail('Aave returned an out-of-range APY.');
  return BigInt(Math.floor(apy * 10_000));
}

export class LendingRateReader {
  constructor(
    readonly ethereum: BridgeEthereum,
    readonly fetcher: typeof fetch = fetch,
    readonly now: () => number = Date.now,
  ) {}

  async aave(): Promise<LendingRate> {
    const observedAt = this.now(),
      head = await this.ethereum.rpc.anchor();
    const block = { blockHash: head.hash, requireCanonical: true };
    const call = (to: Address, functionName: string, args?: readonly unknown[]) =>
      this.ethereum.call(to, encodeFunctionData({ abi: ABI as Abi, functionName, args }), block);
    const [reserveData, capsData, oracleData, configurationData, pausedData, priorities] =
      await Promise.all([
        call(P.dataProvider, 'getReserveData', [P.usdc]),
        call(P.dataProvider, 'getReserveCaps', [P.usdc]),
        call(P.provider, 'getPriceOracle'),
        this.ethereum.call(
          P.dataProvider,
          encodeFunctionData({
            abi: BINDING_ABI,
            functionName: 'getReserveConfigurationData',
            args: [P.usdc],
          }),
          block,
        ),
        this.ethereum.call(
          P.dataProvider,
          encodeFunctionData({ abi: BINDING_ABI, functionName: 'getPaused', args: [P.usdc] }),
          block,
        ),
        Promise.all(
          [0, 1].map(async (source) =>
            quantity(
              (
                await this.ethereum.rpc.batch(source as 0 | 1, [['eth_maxPriorityFeePerGas', []]])
              )[0],
            ),
          ),
        ),
      ]);
    const reserve = decodeFunctionResult({
      abi: ABI,
      functionName: 'getReserveData',
      data: reserveData,
    });
    const caps = decodeFunctionResult({ abi: ABI, functionName: 'getReserveCaps', data: capsData });
    const oracle = decodeFunctionResult({
      abi: ABI,
      functionName: 'getPriceOracle',
      data: oracleData,
    });
    const configuration = decodeFunctionResult({
      abi: BINDING_ABI,
      functionName: 'getReserveConfigurationData',
      data: configurationData,
    });
    const paused = decodeFunctionResult({
      abi: BINDING_ABI,
      functionName: 'getPaused',
      data: pausedData,
    });
    const [usdc, eth, base] = await Promise.all([
      call(oracle, 'getAssetPrice', [P.usdc]),
      call(oracle, 'getAssetPrice', [WETH]),
      call(oracle, 'BASE_CURRENCY_UNIT'),
    ]);
    if (BigInt(base) !== 100_000_000n) return fail('Aave price denomination changed.');
    const supplyCap = caps[1] * 1_000_000n;
    // Include accrued treasury aTokens when evaluating the protocol's supply cap.
    const total = reserve[2] + (reserve[1] * reserve[9]) / 10n ** 27n;
    const priority = priorities.reduce((a, b) => (a > b ? a : b), 100_000_000n);
    await this.ethereum.rpc.recheck(head);
    return {
      network: BRIDGE_ETHEREUM,
      provider: 'aave',
      name: 'Aave V3',
      apyBasisPoints: aaveApyBasisPoints(reserve[5]).toString(),
      observedAt,
      source: 'https://app.aave.com/markets/',
      evidence: `Ethereum block ${BigInt(head.number)} / ${head.hash}`,
      usdcPriceUsd: price((BigInt(usdc) * SCALE) / BigInt(base)),
      nativePriceUsd: price((BigInt(eth) * SCALE) / BigInt(base)),
      maxFeePerGas: (head.baseFee * 2n + priority).toString(),
      capacityAtomic:
        supplyCap === 0n ? null : (supplyCap > total ? supplyCap - total : 0n).toString(),
      available: configuration[8] && !configuration[9] && !paused,
    };
  }

  async kamino(): Promise<LendingRate> {
    const observedAt = this.now();
    const response = await this.fetcher(KAMINO_METRICS_URL, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok || !response.body) return fail('Kamino live rates are unavailable.');
    const date = Date.parse(response.headers.get('date') ?? '');
    const age = Number(response.headers.get('age') ?? '0');
    if (
      !Number.isFinite(date) ||
      Math.abs(observedAt - date) > 300_000 ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 300
    )
      return fail('Kamino returned stale market data.');
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 512_000) return fail('Kamino market data exceeded its size limit.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parseKaminoRates(data, observedAt);
  }
}

export function parseKaminoRates(data: unknown, observedAt: number): LendingRate {
  if (!Array.isArray(data) || data.length > 256) return fail('Invalid Kamino reserve metrics.');
  const find = (mint: string, reserve?: string) => {
    const matches = data.filter(
      (item) => item && item.liquidityTokenMint === mint && (!reserve || item.reserve === reserve),
    );
    if (matches.length !== 1) return fail('The expected Kamino reserve is missing or duplicated.');
    return matches[0] as Record<string, unknown>;
  };
  const usdc = find(SOLANA_USDC.toBase58(), KAMINO_USDC_RESERVE.toBase58()),
    sol = find('So11111111111111111111111111111111111111112');
  if (usdc.liquidityToken !== 'USDC' || sol.liquidityToken !== 'SOL')
    return fail('Kamino token identities changed.');
  const apy = decimalMantissa(usdc.supplyApy);
  if (apy > 100n * SCALE) return fail('Kamino returned an out-of-range APY.');
  const tokenPrice = (row: Record<string, unknown>) => {
    const supply = decimalMantissa(row.totalSupply);
    if (supply <= 0n) return fail('Kamino pricing is unavailable.');
    return price((decimalMantissa(row.totalSupplyUsd) * SCALE) / supply);
  };
  return {
    network: BRIDGE_SOLANA,
    provider: 'kamino',
    name: 'Kamino',
    apyBasisPoints: ((apy * 10_000n) / SCALE).toString(),
    observedAt,
    source: 'https://app.kamino.finance/lending',
    evidence: `Kamino current reserve metrics / ${KAMINO_USDC_RESERVE}`,
    usdcPriceUsd: tokenPrice(usdc),
    nativePriceUsd: tokenPrice(sol),
    capacityAtomic: null,
    available: true,
  };
}
