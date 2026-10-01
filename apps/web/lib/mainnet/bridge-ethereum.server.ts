import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeEventLog,
  encodeDeployData,
  encodeFunctionData,
  getContractAddress,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem';

import { CCTP_SOURCE_ROUTER_ABI } from '../../../../onchain/src/ethereum-source';
import { AAVE_SUPPLY_ROUTER_ABI } from '../../../../onchain/src/destination-lending';
import type { SourceBridgePlan } from '../../../../onchain/src/source-plan';
import {
  CIRCLE_ETHEREUM_MESSENGER,
  CIRCLE_ETHEREUM_TRANSMITTER,
  type BridgeConfig,
  type LocalWalletConfig,
  type BridgeStep,
  type BridgeStepKind,
} from './bridge-types';
import { LENDING_ROUTER_ABI, ROUTED_ETHEREUM_PROVIDERS } from '../lending/ethereum-router';
import { MARKETS } from '../lending/markets';
import { MAINNET_TEST as P, POOL_ABI, TOKEN_ABI, fail } from './policy';
import { MainnetTestRpc, hashValue, quantity, record, type RpcCall } from './rpc.server';

const EXTRA_ABI = parseAbi([
  'function usedNonces(bytes32) view returns (uint256)',
  'event MessageSent(bytes message)',
  'event Supplied(address indexed user,uint256 principal)',
]);
export interface RouterArtifact {
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
  immutableReferences: Record<string, { start: number; length: number }[]>;
}
export function routerArtifact(
  kind: 'DEPLOY_SOURCE' | 'DEPLOY_SUPPLY' | 'DEPLOY_LENDING',
): RouterArtifact {
  const name =
    kind === 'DEPLOY_SOURCE'
      ? 'BonsaiCctpSourceRouter'
      : kind === 'DEPLOY_LENDING'
        ? 'BonsaiLendingRouter'
        : 'BonsaiAaveSupplyRouter';
  const root = process.env.MAINNET_REPOSITORY_ROOT ?? join(process.cwd(), '..', '..');
  let artifact: RouterArtifact;
  try {
    artifact = JSON.parse(
      readFileSync(join(root, 'onchain', 'build', `${name}.json`), 'utf8'),
    ) as RouterArtifact;
  } catch {
    return fail('Build the bridge contracts first: npm run build --prefix onchain.');
  }
  if (
    !/^0x[0-9a-f]+$/.test(artifact.bytecode) ||
    artifact.bytecode.length > 98_306 ||
    !artifact.immutableReferences
  )
    return fail('Invalid compiled router artifact.');
  return artifact;
}
export function compareRouterCode(actual: Hex, artifact: RouterArtifact) {
  const expected = Buffer.from(artifact.deployedBytecode.slice(2), 'hex'),
    deployed = Buffer.from(actual.slice(2), 'hex');
  if (deployed.length !== expected.length)
    return fail('The router bytecode does not match the locally compiled contract.');
  for (const refs of Object.values(artifact.immutableReferences))
    for (const ref of refs) {
      if (
        !Number.isInteger(ref.start) ||
        ref.length !== 32 ||
        ref.start < 0 ||
        ref.start + ref.length > expected.length
      )
        return fail('Invalid compiled immutable reference.');
      expected.fill(0, ref.start, ref.start + ref.length);
      deployed.fill(0, ref.start, ref.start + ref.length);
    }
  if (!deployed.equals(expected))
    return fail('The router bytecode does not match the locally compiled contract.');
}

export class BridgeEthereum {
  constructor(readonly rpc = new MainnetTestRpc()) {}
  async call(to: Address, data: Hex, block: unknown = 'latest'): Promise<Hex> {
    const [value] = await this.rpc.pair([['eth_call', [{ to, data }, block]]]);
    if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(value))
      return fail('Invalid Ethereum contract return value.');
    return value as Hex;
  }
  async allowance(wallet: Address, spender: Address) {
    return BigInt(
      await this.call(
        P.usdc,
        encodeFunctionData({ abi: TOKEN_ABI, functionName: 'allowance', args: [wallet, spender] }),
      ),
    );
  }
  lendingDeploymentCall(config: LocalWalletConfig) {
    if (!config.ethereumWallet) return fail('Connect an Ethereum wallet first.');
    const artifact = routerArtifact('DEPLOY_LENDING');
    return {
      from: config.ethereumWallet,
      data: encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args: [
          P.usdc,
          config.ethereumTreasury,
          ROUTED_ETHEREUM_PROVIDERS.map((provider) => MARKETS[provider].target),
        ],
      }),
    };
  }
  async validateLendingRouter(config: LocalWalletConfig) {
    const target = config.ethereumLendingRouter;
    if (!target) return fail('Complete the Ethereum lending setup before depositing.');
    const head = await this.rpc.anchor(),
      block = { blockHash: head.hash, requireCanonical: true };
    const [code] = await this.rpc.pair([['eth_getCode', [target, block]]]);
    compareRouterCode(String(code) as Hex, routerArtifact('DEPLOY_LENDING'));
    const calls = [
      encodeFunctionData({ abi: LENDING_ROUTER_ABI, functionName: 'usdc' }),
      encodeFunctionData({ abi: LENDING_ROUTER_ABI, functionName: 'treasury' }),
      ...ROUTED_ETHEREUM_PROVIDERS.map((_, index) =>
        encodeFunctionData({
          abi: LENDING_ROUTER_ABI,
          functionName: 'targets',
          args: [BigInt(index)],
        }),
      ),
    ];
    const expected = [
      P.usdc,
      config.ethereumTreasury,
      ...ROUTED_ETHEREUM_PROVIDERS.map((provider) => MARKETS[provider].target),
    ];
    const values = await this.rpc.pair(
      calls.map((data) => ['eth_call', [{ to: target, data }, block]] as RpcCall),
    );
    values.forEach((value, index) => {
      if (
        typeof value !== 'string' ||
        !/^0x[0-9a-f]{64}$/.test(value) ||
        BigInt(value) !== BigInt(expected[index]!)
      )
        return fail('The lending router treasury or destinations changed.');
    });
    await this.rpc.recheck(head);
  }
  async minted(nonce: Hex) {
    return (
      BigInt(
        await this.call(
          CIRCLE_ETHEREUM_TRANSMITTER,
          encodeFunctionData({ abi: EXTRA_ABI, functionName: 'usedNonces', args: [nonce] }),
          'finalized',
        ),
      ) !== 0n
    );
  }
  async validateRouter(config: BridgeConfig, kind: 'DEPLOY_SOURCE' | 'DEPLOY_SUPPLY') {
    const target =
      kind === 'DEPLOY_SOURCE' ? config.ethereumSourceRouter : config.ethereumSupplyRouter;
    if (!target) return fail('Deploy and verify both Ethereum routers before starting a bridge.');
    const head = await this.rpc.anchor();
    const block = { blockHash: head.hash, requireCanonical: true };
    const [code] = await this.rpc.pair([['eth_getCode', [target, block]]]);
    compareRouterCode(String(code) as Hex, routerArtifact(kind));
    const pairs: [Abi, string, Address][] =
      kind === 'DEPLOY_SOURCE'
        ? [
            [CCTP_SOURCE_ROUTER_ABI, 'usdc', P.usdc],
            [CCTP_SOURCE_ROUTER_ABI, 'messenger', CIRCLE_ETHEREUM_MESSENGER],
            [CCTP_SOURCE_ROUTER_ABI, 'treasury', config.ethereumTreasury],
            [CCTP_SOURCE_ROUTER_ABI, 'quoteAuthority', config.ethereumWallet],
          ]
        : [
            [AAVE_SUPPLY_ROUTER_ABI, 'usdc', P.usdc],
            [AAVE_SUPPLY_ROUTER_ABI, 'pool', P.pool],
            [AAVE_SUPPLY_ROUTER_ABI, 'aToken', P.aToken],
            [AAVE_SUPPLY_ROUTER_ABI, 'messageTransmitter', CIRCLE_ETHEREUM_TRANSMITTER],
          ];
    const results = await this.rpc.pair(
      pairs.map(
        ([abi, functionName]) =>
          [
            'eth_call',
            [{ to: target, data: encodeFunctionData({ abi, functionName }) }, block],
          ] as RpcCall,
      ),
    );
    results.forEach((result, index) => {
      if (
        typeof result !== 'string' ||
        !/^0x[0-9a-f]{64}$/.test(result) ||
        BigInt(result) !== BigInt(pairs[index]![2])
      )
        return fail('A router immutable address does not match this test configuration.');
    });
    await this.rpc.recheck(head);
  }
  deploymentCall(config: BridgeConfig, kind: 'DEPLOY_SOURCE' | 'DEPLOY_SUPPLY') {
    const artifact = routerArtifact(kind);
    return {
      from: config.ethereumWallet,
      data: encodeDeployData({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args:
          kind === 'DEPLOY_SOURCE'
            ? [P.usdc, CIRCLE_ETHEREUM_MESSENGER, config.ethereumTreasury, config.ethereumWallet]
            : [P.usdc, P.pool, P.aToken, CIRCLE_ETHEREUM_TRANSMITTER],
      }),
    };
  }
  async prepare(call: { from: Address; to?: Address; data: Hex }, kind: BridgeStepKind) {
    // Market identity, debt and allowance are checked by the selected lender.
    // Transaction funding must not depend on another lender being available.
    const head = await this.rpc.anchor();
    const block = { blockHash: head.hash, requireCanonical: true };
    const [balance, code, latestNonce, pendingNonce] = await this.rpc.pair([
      ['eth_getBalance', [call.from, block]],
      ['eth_getCode', [call.from, block]],
      ['eth_getTransactionCount', [call.from, 'latest']],
      ['eth_getTransactionCount', [call.from, 'pending']],
    ]);
    if (code !== '0x')
      return fail('Use an externally owned wallet without delegated account code.');
    if (quantity(latestNonce) !== quantity(pendingNonce))
      return fail('This wallet has another pending transaction. Resolve it first.');
    const eth = quantity(balance);
    const value = { ...call, value: '0x0' as const };
    await this.rpc.pair([['eth_call', [value, { blockHash: head.hash, requireCanonical: true }]]]);
    const results = await Promise.all(
      [0, 1].map((source) =>
        this.rpc.batch(source as 0 | 1, [
          ['eth_estimateGas', [value, head.number]],
          ['eth_maxPriorityFeePerGas', []],
        ]),
      ),
    );
    const gas =
      (results.map((r) => quantity(r[0])).reduce((a, b) => (a > b ? a : b)) * 125n + 99n) / 100n;
    const priority = results.map((r) => quantity(r[1])).reduce((a, b) => (a > b ? a : b));
    const maxFee = head.baseFee * 2n + (priority > 0n ? priority : 100_000_000n);
    const deploy = kind.startsWith('DEPLOY_');
    const cap = deploy ? 10_000_000_000_000_000n : 2_000_000_000_000_000n;
    const cost = gas * maxFee;
    if (gas > (deploy ? 6_000_000n : 1_400_000n) || maxFee > 20_000_000_000n || cost > cap)
      return fail(
        'Current Ethereum gas costs exceed the test limit. Try again when fees are lower.',
      );
    if (eth < cost + P.gasReserve)
      return fail('The Ethereum wallet needs gas plus a 0.001 ETH reserve.');
    await this.rpc.recheck(head);
    return {
      transaction: {
        ...value,
        chainId: '0x1' as const,
        type: '0x2' as const,
        nonce: toHex(quantity(latestNonce)),
        gas: toHex(gas),
        maxFeePerGas: toHex(maxFee),
        maxPriorityFeePerGas: toHex(priority),
      },
      cost: cost.toString(),
      snapshot: { wallet: call.from, eth: eth.toString() },
    };
  }
  async revalidate(step: BridgeStep) {
    const tx = step.ethereum;
    if (!tx) return fail('An Ethereum transaction is required.');
    const fresh = await this.prepare(
      { from: tx.from, ...(tx.to ? { to: tx.to } : {}), data: tx.data },
      step.kind,
    );
    if (
      fresh.transaction.nonce !== tx.nonce ||
      quantity(fresh.transaction.gas) > quantity(tx.gas) ||
      quantity(fresh.transaction.maxFeePerGas) > quantity(tx.maxFeePerGas) ||
      BigInt(fresh.snapshot.eth) < BigInt(step.maxNetworkCost) + P.gasReserve
    )
      return fail(
        'Ethereum funding, gas, or nonce changed. Prepare a fresh review before signing.',
      );
  }
  async receipt(step: BridgeStep, transactionId: string) {
    const hash = hashValue(transactionId),
      expected = step.ethereum!;
    const results = await Promise.all(
      [0, 1].map((source) =>
        this.rpc.batch(source as 0 | 1, [
          ['eth_chainId', []],
          ['eth_getTransactionByHash', [hash]],
          ['eth_getTransactionReceipt', [hash]],
        ]),
      ),
    );
    if (results.some((row) => row[0] !== '0x1'))
      return fail('Ethereum recovery requires mainnet RPCs.');
    if (results.some((row) => row[1] === null))
      return { matched: false, state: 'SUBMITTED' as const, receipt: null, contractAddress: null };
    for (const row of results) {
      const tx = record(row[1]);
      if (
        tx.hash !== hash ||
        String(tx.from).toLowerCase() !== expected.from.toLowerCase() ||
        (expected.to
          ? String(tx.to).toLowerCase() !== expected.to.toLowerCase()
          : tx.to !== null) ||
        tx.input !== expected.data ||
        tx.chainId !== '0x1' ||
        tx.type !== '0x2' ||
        quantity(tx.value) !== 0n ||
        quantity(tx.nonce) !== quantity(expected.nonce) ||
        quantity(tx.gas) > quantity(expected.gas) ||
        quantity(tx.maxFeePerGas) > quantity(expected.maxFeePerGas) ||
        quantity(tx.maxPriorityFeePerGas) > quantity(expected.maxPriorityFeePerGas)
      )
        return fail('The Ethereum transaction does not match the saved bridge step.');
    }
    if (results.some((row) => row[2] === null))
      return { matched: true, state: 'SUBMITTED' as const, receipt: null, contractAddress: null };
    const receipts = results.map((row) => record(row[2])),
      receipt = receipts[0]!;
    for (const other of receipts) {
      for (const field of [
        'blockHash',
        'blockNumber',
        'transactionHash',
        'status',
        'contractAddress',
      ]) {
        if (other[field] !== receipt[field]) return fail('The Ethereum receipt sources disagree.');
      }
      if (
        receipt.transactionHash !== hash ||
        !['0x0', '0x1'].includes(String(receipt.status)) ||
        String(other.from).toLowerCase() !== expected.from.toLowerCase() ||
        quantity(other.gasUsed) > quantity(expected.gas) ||
        quantity(other.effectiveGasPrice) > quantity(expected.maxFeePerGas)
      )
        return fail('The Ethereum receipt exceeded its identity or gas limits.');
      if (!Array.isArray(other.logs)) return fail('Invalid Ethereum receipt logs.');
      const logView = (logs: unknown[]) =>
        logs.map((entry) => {
          const log = record(entry);
          return [
            log.address,
            log.topics,
            log.data,
            log.transactionHash,
            log.blockHash,
            log.removed ?? false,
          ];
        });
      if (
        JSON.stringify(logView(other.logs)) !== JSON.stringify(logView(receipt.logs as unknown[]))
      )
        return fail('The Ethereum receipt logs disagree.');
    }
    const block = {
      number: toHex(quantity(receipt.blockNumber)),
      hash: hashValue(receipt.blockHash),
      baseFee: 0n,
    };
    await this.rpc.recheck(block);
    const final = await this.rpc.anchor('finalized');
    let contractAddress: Address | null = null;
    if (!expected.to && receipt.status === '0x1') {
      contractAddress = getContractAddress({
        from: expected.from,
        nonce: quantity(expected.nonce),
      }).toLowerCase() as Address;
      if (String(receipt.contractAddress).toLowerCase() !== contractAddress)
        return fail('Unexpected deployed contract address.');
    }
    return {
      matched: true,
      state:
        quantity(final.number) < quantity(block.number)
          ? ('CONFIRMED' as const)
          : receipt.status === '0x1'
            ? ('FINALIZED' as const)
            : ('FAILED' as const),
      receipt,
      contractAddress,
    };
  }
  events(receipt: Record<string, unknown>) {
    const decoded: { address: string; name: string; args: Record<string, unknown> }[] = [];
    for (const entry of receipt.logs as unknown[]) {
      const log = record(entry);
      if (
        log.transactionHash !== receipt.transactionHash ||
        log.blockHash !== receipt.blockHash ||
        log.removed === true
      )
        return fail('Invalid Ethereum log identity.');
      try {
        const event = decodeEventLog({
          abi: [
            ...CCTP_SOURCE_ROUTER_ABI,
            ...LENDING_ROUTER_ABI,
            ...EXTRA_ABI,
            ...TOKEN_ABI,
            ...POOL_ABI,
          ],
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
          strict: true,
        });
        decoded.push({
          address: String(log.address).toLowerCase(),
          name: event.eventName,
          args: event.args as unknown as Record<string, unknown>,
        });
      } catch {
        /* Other protocol events do not establish bridge completion. */
      }
    }
    return decoded;
  }
  verifyLendingFee(step: BridgeStep, receipt: Record<string, unknown>) {
    if (!step.evidence.lendingRouter) return;
    const events = this.events(receipt),
      router = step.evidence.lendingRouter.toLowerCase(),
      fee = BigInt(step.evidence.platformFee!),
      principal = BigInt(step.evidence.amount!);
    const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();
    if (
      !events.some(
        (e) =>
          e.address === router &&
          e.name === 'Lent' &&
          same(e.args.user, step.wallet) &&
          same(e.args.target, MARKETS[step.evidence.provider as keyof typeof MARKETS].target) &&
          e.args.principal === principal &&
          e.args.fee === fee,
      ) ||
      !events.some(
        (e) =>
          e.address === P.usdc &&
          e.name === 'Transfer' &&
          same(e.args.from, step.wallet) &&
          same(e.args.to, router) &&
          e.args.value === principal + fee,
      ) ||
      (fee > 0n &&
        !events.some(
          (e) =>
            e.address === P.usdc &&
            e.name === 'Transfer' &&
            same(e.args.from, router) &&
            same(e.args.to, step.evidence.feeTreasury!) &&
            e.args.value === fee,
        ))
    )
      return fail('The finalized lending debit and treasury routing fee were not verified.');
  }
  sourceMessage(
    config: BridgeConfig,
    plan: SourceBridgePlan,
    receipt: Record<string, unknown>,
  ): Hex {
    const events = this.events(receipt),
      router = config.ethereumSourceRouter!;
    const same = (value: unknown, expected: string) =>
      String(value).toLowerCase() === expected.toLowerCase();
    const source = events.filter(
      (event) =>
        event.address === router &&
        event.name === 'SourceBridgeInitiated' &&
        same(event.args.intentId, plan.intentId) &&
        same(event.args.user, plan.sourceWallet) &&
        same(event.args.treasury, plan.treasury) &&
        same(event.args.mintRecipient, plan.mintRecipient) &&
        event.args.principal === plan.principal &&
        event.args.platformFee === plan.platformFee &&
        event.args.maxBridgeFee === plan.maxBridgeFee &&
        event.args.minimumDestinationAmount === plan.minimumDestinationAmount,
    );
    const messages = events.filter(
      (event) => event.address === CIRCLE_ETHEREUM_TRANSMITTER && event.name === 'MessageSent',
    );
    const feePaid =
      plan.platformFee === 0n ||
      events.some(
        (event) =>
          event.address === P.usdc &&
          event.name === 'Transfer' &&
          same(event.args.from, router) &&
          same(event.args.to, plan.treasury) &&
          event.args.value === plan.platformFee,
      );
    if (source.length !== 1 || messages.length !== 1 || !feePaid)
      return fail('The finalized source burn, fee, and Circle message were not all verified.');
    const message = messages[0]!.args.message;
    if (typeof message !== 'string' || !/^0x[0-9a-f]{824}$/.test(message))
      return fail('Unexpected source Circle message.');
    return message as Hex;
  }
}
