import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
  zeroAddress,
  type Abi,
  type Address,
} from 'viem';
import { COMET_ABI, VAULT_ABI, BLUE_ABI, SPARK_ABI, blueParams } from '../lending/evm-markets';
import {
  ETH_USDC,
  ETHEREUM,
  MARKETS,
  MORPHO,
  SPARK,
  type LendingProvider,
} from '../lending/markets';
import { BridgeEthereum } from './bridge-ethereum.server';
import { fingerprint } from './bridge-journal.server';
import { TOKEN_ABI, fail } from './policy';
import { aaveApyBasisPoints } from './lending-rates.server';

const WAD = 10n ** 18n,
  RAY = 10n ** 27n,
  YEAR = 31_536_000n;
const EXTRA = parseAbi([
  'function baseInterestRate() view returns(uint256)',
  'function totalBorrowed() view returns(uint256)',
  'function withdrawFee() view returns(uint256)',
  'function underlyingToken() view returns(address)',
  'function interestRate() view returns(uint256)',
  'function interestFee() view returns(uint16)',
  'function totalBorrows() view returns(uint256)',
  'function debtOf(address) view returns(uint256)',
]);
export interface EthereumMarketState {
  provider: LendingProvider;
  observedAt: number;
  apyBasisPoints: string;
  capacity: bigint | null;
  available: boolean;
  withdrawalFeeBps: bigint;
  shares: bigint;
  supplied: bigint;
  debt: bigint;
  allowance: bigint;
  walletUsdc: bigint;
  liquidity: bigint;
  binding: string;
}
export function aprToApyBps(apr: bigint, scale = WAD) {
  if (apr < 0n || apr > scale * 10n)
    return fail('The protocol returned an out-of-range supply rate.');
  return aaveApyBasisPoints((apr * RAY) / scale);
}

/** Reads only the explicitly selected market, corroborated at one canonical block. */
export class EthereumLendingMarkets {
  constructor(readonly ethereum: BridgeEthereum) {}
  async read(
    provider: LendingProvider,
    wallet: Address = zeroAddress,
  ): Promise<EthereumMarketState> {
    const market = MARKETS[provider];
    if (market.network !== ETHEREUM || provider === 'aave')
      return fail('Choose an implemented Ethereum lending market.');
    const observedAt = Date.now(),
      head = await this.ethereum.rpc.anchor(),
      target = market.target as Address;
    const block = { blockHash: head.hash, requireCanonical: true };
    const call = async (
      abi: Abi,
      functionName: string,
      args: readonly unknown[] = [],
      to = target,
    ) => {
      const data = await this.ethereum.call(
        to,
        encodeFunctionData({ abi, functionName, args }),
        block,
      );
      return decodeFunctionResult({ abi, functionName, data });
    };
    const uint = async (abi: Abi, name: string, args: readonly unknown[] = [], to = target) =>
      BigInt(String(await call(abi, name, args, to)));
    const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    const [code, implementation] = await this.ethereum.rpc.pair([
      ['eth_getCode', [target, block]],
      ['eth_getStorageAt', [target, implSlot, block]],
    ]);
    if (typeof code !== 'string' || code.length < 4)
      return fail(`${market.name} is not deployed at its configured address.`);
    const implAddress = `0x${String(implementation).slice(-40)}` as Address;
    const implCode =
      BigInt(String(implementation)) === 0n
        ? code
        : (await this.ethereum.rpc.pair([['eth_getCode', [implAddress, block]]]))[0];
    const state: EthereumMarketState = {
      provider,
      observedAt,
      apyBasisPoints: '0',
      capacity: null,
      available: false,
      withdrawalFeeBps: 0n,
      shares: 0n,
      supplied: 0n,
      debt: 0n,
      allowance: 0n,
      walletUsdc: 0n,
      liquidity: 0n,
      binding: fingerprint({
        target,
        codeHash: keccak256(code as `0x${string}`),
        implementation,
        implCode,
      }),
    };
    [state.walletUsdc, state.allowance, state.liquidity] = await Promise.all([
      uint(TOKEN_ABI, 'balanceOf', [wallet], ETH_USDC),
      uint(TOKEN_ABI, 'allowance', [wallet, target], ETH_USDC),
      uint(TOKEN_ABI, 'balanceOf', [provider === 'spark' ? SPARK.receipt : target], ETH_USDC),
    ]);
    if (provider === 'compound') {
      const [asset, utilization, paused, shares, debt] = await Promise.all([
        call(COMET_ABI, 'baseToken'),
        uint(COMET_ABI, 'getUtilization'),
        call(COMET_ABI, 'isSupplyPaused'),
        uint(COMET_ABI, 'balanceOf', [wallet]),
        uint(COMET_ABI, 'borrowBalanceOf', [wallet]),
      ]);
      if (String(asset).toLowerCase() !== ETH_USDC) return fail('Compound base asset changed.');
      state.apyBasisPoints = aprToApyBps(
        (await uint(COMET_ABI, 'getSupplyRate', [utilization])) * YEAR,
      ).toString();
      state.available = paused === false;
      state.shares = shares;
      state.supplied = shares;
      state.debt = debt;
    } else if (provider === 'spark') {
      const [data, config, caps, paused, tokens, supplied, account] = (await Promise.all([
        call(SPARK_ABI, 'getReserveData', [ETH_USDC], SPARK.dataProvider),
        call(SPARK_ABI, 'getReserveConfigurationData', [ETH_USDC], SPARK.dataProvider),
        call(SPARK_ABI, 'getReserveCaps', [ETH_USDC], SPARK.dataProvider),
        call(SPARK_ABI, 'getPaused', [ETH_USDC], SPARK.dataProvider),
        call(SPARK_ABI, 'getReserveTokensAddresses', [ETH_USDC], SPARK.dataProvider),
        uint(TOKEN_ABI, 'balanceOf', [wallet], SPARK.receipt),
        call(SPARK_ABI, 'getUserAccountData', [wallet]),
      ])) as [
        readonly bigint[],
        readonly unknown[],
        readonly bigint[],
        boolean,
        readonly Address[],
        bigint,
        readonly bigint[],
      ];
      if (tokens[0]!.toLowerCase() !== SPARK.receipt || config[0] !== 6n)
        return fail('Spark USDC receipt identity changed.');
      const total = data[2]! + (data[1]! * data[9]!) / RAY,
        cap = caps[1]! * 1_000_000n;
      state.capacity = cap === 0n ? null : cap > total ? cap - total : 0n;
      state.available = config[8] === true && config[9] === false && !paused;
      state.apyBasisPoints = aaveApyBasisPoints(data[5]!).toString();
      state.shares = supplied;
      state.supplied = supplied;
      state.debt = account[1]!;
    } else if (provider === 'morpho') {
      const [params, raw, position] = (await Promise.all([
        call(BLUE_ABI, 'idToMarketParams', [MORPHO.id]),
        call(BLUE_ABI, 'market', [MORPHO.id]),
        call(BLUE_ABI, 'position', [MORPHO.id, wallet]),
      ])) as [ReturnType<typeof blueParams>, readonly bigint[], readonly bigint[]];
      for (const [key, value] of Object.entries(blueParams()))
        if (
          String(params[key as keyof typeof params]).toLowerCase() !== String(value).toLowerCase()
        )
          return fail('The Morpho market parameters changed.');
      const [supplied, shares, borrowed, borrowShares, lastUpdate, fee] = raw as [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
      ];
      if (lastUpdate <= 0n || fee > WAD / 4n || borrowed > supplied)
        return fail('The Morpho market state is unavailable.');
      const perSecond = await uint(
        BLUE_ABI,
        'borrowRateView',
        [
          blueParams(),
          {
            totalSupplyAssets: supplied,
            totalSupplyShares: shares,
            totalBorrowAssets: borrowed,
            totalBorrowShares: borrowShares,
            lastUpdate,
            fee,
          },
        ],
        MORPHO.irm,
      );
      // Morpho's raw market storage omits accrual. Project its documented third-order
      // Taylor accrual before computing utilization, fee shares and the owned position.
      const headers = await Promise.all(
        [0, 1].map(
          async (source) =>
            (
              await this.ethereum.rpc.batch(source as 0 | 1, [
                ['eth_getBlockByNumber', [head.number, false]],
              ])
            )[0] as { hash: string; number: string; timestamp: string },
        ),
      );
      if (
        headers.some(
          (header) =>
            header.hash !== head.hash ||
            header.number !== head.number ||
            header.timestamp !== headers[0]!.timestamp,
        )
      )
        return fail('The Morpho accrual block changed.');
      const elapsed = BigInt(headers[0]!.timestamp) - lastUpdate;
      if (elapsed < 0n || perSecond > WAD) return fail('Invalid Morpho accrual context.');
      const first = perSecond * elapsed,
        second = (first * first) / (2n * WAD),
        third = (second * first) / (3n * WAD);
      const interest = (borrowed * (first + second + third)) / WAD,
        assetsNow = supplied + interest,
        debtNow = borrowed + interest;
      const feeAssets = (interest * fee) / WAD,
        sharesNow = shares + (feeAssets * (shares + 1_000_000n)) / (assetsNow - feeAssets + 1n);
      const supplyApr = assetsNow
        ? (((perSecond * YEAR * debtNow) / assetsNow) * (WAD - fee)) / WAD
        : 0n;
      state.apyBasisPoints = aprToApyBps(supplyApr).toString();
      state.available = true;
      state.shares = position[0]!;
      state.supplied = (position[0]! * (assetsNow + 1n)) / (sharesNow + 1_000_000n);
      state.debt = position[1]!;
      state.liquidity = assetsNow - debtNow;
    } else {
      const [asset, assets, shares, capacity] = await Promise.all([
        call(VAULT_ABI, 'asset'),
        uint(VAULT_ABI, 'totalAssets'),
        uint(VAULT_ABI, 'balanceOf', [wallet]),
        uint(VAULT_ABI, 'maxDeposit', [wallet]),
      ]);
      if (String(asset).toLowerCase() !== ETH_USDC)
        return fail(`${market.name} underlying asset changed.`);
      state.shares = shares;
      state.supplied = await uint(VAULT_ABI, 'convertToAssets', [shares]);
      state.capacity = capacity;
      state.available = capacity > 0n;
      if (provider === 'euler') {
        const [borrowRate, fee, borrowed, debt] = await Promise.all([
          uint(EXTRA, 'interestRate'),
          uint(EXTRA, 'interestFee'),
          uint(EXTRA, 'totalBorrows'),
          uint(EXTRA, 'debtOf', [wallet]),
        ]);
        if (fee > 10_000n || borrowed > assets)
          return fail('Euler returned invalid lending totals.');
        state.apyBasisPoints = aprToApyBps(
          assets ? (((borrowRate * YEAR * borrowed) / assets) * (10_000n - fee)) / 10_000n : 0n,
          RAY,
        ).toString();
        state.debt = debt;
      } else {
        const [rate, borrowed, fee] = await Promise.all([
          uint(EXTRA, 'baseInterestRate'),
          uint(EXTRA, 'totalBorrowed'),
          uint(EXTRA, 'withdrawFee'),
        ]);
        if (borrowed > assets || fee > 10_000n)
          return fail('Gearbox returned invalid lending totals.');
        state.apyBasisPoints = aprToApyBps(
          assets ? (rate * borrowed) / assets : 0n,
          RAY,
        ).toString();
        state.withdrawalFeeBps = fee;
      }
    }
    await this.ethereum.rpc.recheck(head);
    return state;
  }
}
