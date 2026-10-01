import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { NetworkConnection } from 'hardhat/types/network';
import { createPublicClient, createWalletClient, custom, parseEventLogs, type Address } from 'viem';
import { hardhat } from 'viem/chains';
import { compileContracts, type CompiledContract } from '../scripts/compile.mjs';
import { lendingRoutingFee } from '../src/lending-fee.js';

let network: NetworkConnection, reader: ReturnType<typeof createPublicClient>, wallet: ReturnType<typeof createWalletClient>;
let accounts: Address[], compiled: ReturnType<typeof compileContracts>, token: Address, router: Address, market: Address, snapshot: string;
const artifact = (name: string): CompiledContract => {
  for (const entries of Object.values(compiled)) if (entries[name]) return entries[name];
  throw new Error(name);
};
async function deploy(name: string, args: readonly unknown[] = []) {
  const a = artifact(name);
  const hash = await wallet.deployContract({ chain: hardhat, account: accounts[0], abi: a.abi, bytecode: `0x${a.evm.bytecode.object}`, args });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success'); return receipt.contractAddress!;
}
async function write(address: Address, name: string, functionName: string, args: readonly unknown[]) {
  const hash = await wallet.writeContract({ chain: hardhat, account: accounts[0], address, abi: artifact(name).abi, functionName, args });
  const receipt = await reader.waitForTransactionReceipt({ hash }); assert.equal(receipt.status, 'success'); return receipt;
}
const balance = (address: Address) => reader.readContract({ address: token, abi: artifact('TestUsdc').abi, functionName: 'balanceOf', args: [address] });
before(async () => {
  compiled = compileContracts(true);
  const runtime = await createHardhatRuntimeEnvironment({ networks: { lending: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 } } }, {}, fileURLToPath(new URL('..', import.meta.url)));
  network = await runtime.network.create('lending');
  const transport = custom(network.provider);
  reader = createPublicClient({ chain: hardhat, transport }); wallet = createWalletClient({ chain: hardhat, transport }); accounts = await wallet.getAddresses();
  token = await deploy('TestUsdc'); market = await deploy('TestLendingMarket', [token]);
  router = await deploy('BonsaiLendingRouter', [token, accounts[1], Array(6).fill(market)]);
  await write(token, 'TestUsdc', 'mint', [accounts[0], 20_000_000_000n]);
  snapshot = await network.provider.request({ method: 'evm_snapshot' }) as string;
});
afterEach(async () => { await network.provider.request({ method: 'evm_revert', params: [snapshot] }); snapshot = await network.provider.request({ method: 'evm_snapshot' }) as string; });
after(async () => { await network.close(); });

for (const [provider, name] of ['aave', 'morpho', 'compound', 'spark', 'euler', 'gearbox'].entries()) {
  test(`${name}: deposits principal to the wallet position and collects exactly 0.10%`, async () => {
    const principal = 100_000_000n, fee = 100_000n;
    await write(token, 'TestUsdc', 'approve', [router, principal + fee]);
    const receipt = await write(router, 'BonsaiLendingRouter', 'supply', [provider, principal]);
    assert.equal(await balance(accounts[0]!), 20_000_000_000n - principal - fee);
    assert.equal(await balance(accounts[1]!), fee); assert.equal(await balance(router), 0n);
    assert.equal(await reader.readContract({ address: market, abi: artifact('TestLendingMarket').abi, functionName: 'supplied', args: [accounts[0]] }), principal);
    assert.equal(await reader.readContract({ address: token, abi: artifact('TestUsdc').abi, functionName: 'allowance', args: [router, market] }), 0n);
    const events = parseEventLogs({ abi: artifact('BonsaiLendingRouter').abi, eventName: 'Lent', logs: receipt.logs });
    assert.equal(events.length, 1);
  });
  test(`${name}: a failed deposit also rolls back the treasury fee`, async () => {
    await write(token, 'TestUsdc', 'approve', [router, 1_001_000n]); await write(market, 'TestLendingMarket', 'setFailure', [true]);
    await assert.rejects(write(router, 'BonsaiLendingRouter', 'supply', [provider, 1_000_000n]));
    assert.equal(await balance(accounts[0]!), 20_000_000_000n); assert.equal(await balance(accounts[1]!), 0n); assert.equal(await balance(router), 0n);
  });
}
test('atomic-unit rounding agrees with quotes including half-even ties and tiny deposits', async () => {
  for (const principal of [1n, 500n, 501n, 1000n, 1500n, 2500n, 1_000_500n, 1_001_500n]) {
    const fee = lendingRoutingFee(principal), before = await balance(accounts[1]!) as bigint;
    await write(token, 'TestUsdc', 'approve', [router, principal + fee]); await write(router, 'BonsaiLendingRouter', 'supply', [0, principal]);
    assert.equal(await balance(accounts[1]!), before + fee);
  }
});
test('rejects principal-only funding, unsupported destinations and zero amounts without collecting a fee', async () => {
  await write(token, 'TestUsdc', 'approve', [router, 1_000_000n]);
  for (const [provider, principal] of [[0, 1_000_000n], [6, 100n], [0, 0n]] as const) await assert.rejects(write(router, 'BonsaiLendingRouter', 'supply', [provider, principal]));
  assert.equal(await balance(accounts[1]!), 0n);
});
