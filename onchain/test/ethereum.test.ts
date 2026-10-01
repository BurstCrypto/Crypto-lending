import assert from 'node:assert/strict';
import { before, after, afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { NetworkConnection } from 'hardhat/types/network';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  hashTypedData,
  parseEventLogs,
  type Address,
  type Hex,
} from 'viem';
import { hardhat } from 'viem/chains';
import { compileContracts, type CompiledContract } from '../scripts/compile.mjs';
import { BRIDGE_INTENT_TYPES, MAX_U64 } from '../src/source-plan.js';
import { calculateRoutingFeeAtomicAmount } from '../../apps/api/src/routing-fees/domain/routing-fee.ts';

let network: NetworkConnection;
let reader: ReturnType<typeof createPublicClient>;
let wallet: ReturnType<typeof createWalletClient>;
let accounts: Address[];
let compiled: ReturnType<typeof compileContracts>;
let token: Address,
  messenger: Address,
  router: Address,
  pool: Address,
  aToken: Address,
  supplyRouter: Address,
  transmitter: Address;
let snapshot: string;
const principal = 1_000_000_000n;
const fee = 2_000_000n;

const artifact = (name: string): CompiledContract => {
  for (const entries of Object.values(compiled)) if (entries[name]) return entries[name];
  throw new Error(`Missing contract ${name}`);
};
async function deploy(name: string, args: readonly unknown[] = []) {
  const build = artifact(name);
  const hash = await wallet.deployContract({
    chain: hardhat,
    account: accounts[0],
    abi: build.abi,
    bytecode: `0x${build.evm.bytecode.object}`,
    args,
  });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  assert.ok(receipt.contractAddress);
  return receipt.contractAddress;
}
async function write(
  address: Address,
  name: string,
  functionName: string,
  args: readonly unknown[],
  account = accounts[0],
) {
  const hash = await wallet.writeContract({
    chain: hardhat,
    account,
    address,
    abi: artifact(name).abi,
    functionName,
    args,
  });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, 'success');
  return receipt;
}
const balance = (address: Address, asset = token) =>
  reader.readContract({
    address: asset,
    abi: artifact('TestUsdc').abi,
    functionName: 'balanceOf',
    args: [address],
  });

before(async () => {
  compiled = compileContracts(true);
  const runtime = await createHardhatRuntimeEnvironment(
    {
      networks: { source: { type: 'edr-simulated', chainType: 'l1', chainId: 31337 } },
    },
    {},
    fileURLToPath(new URL('..', import.meta.url)),
  );
  network = await runtime.network.create('source');
  const transport = custom(network.provider);
  reader = createPublicClient({ chain: hardhat, transport });
  wallet = createWalletClient({ chain: hardhat, transport });
  accounts = await wallet.getAddresses();
  token = await deploy('TestUsdc');
  messenger = await deploy('TestMessenger');
  router = await deploy('BonsaiCctpSourceRouter', [token, messenger, accounts[1], accounts[2]]);
  aToken = await deploy('TestUsdc');
  pool = await deploy('TestPool', [aToken]);
  transmitter = await deploy('TestMessageTransmitter', [token]);
  supplyRouter = await deploy('BonsaiAaveSupplyRouter', [token, pool, aToken, transmitter]);
  await write(token, 'TestUsdc', 'mint', [accounts[0], 10n * principal]);
  snapshot = (await network.provider.request({ method: 'evm_snapshot' })) as string;
});
afterEach(async () => {
  await network.provider.request({ method: 'evm_revert', params: [snapshot] });
  snapshot = (await network.provider.request({ method: 'evm_snapshot' })) as string;
});
after(async () => {
  await network?.close();
});

async function quote(overrides: Record<string, unknown> = {}) {
  const block = await reader.getBlock();
  const intent = {
    intentId: `0x${'51'.repeat(32)}` as Hex,
    user: accounts[0],
    mintRecipient: `0x${'72'.repeat(32)}` as Hex,
    principal,
    maxBridgeFee: 100_000n,
    minimumDestinationAmount: principal - 100_000n,
    feeBps: 20,
    deadline: block.timestamp + 240n,
    ...overrides,
  };
  const typed = {
    domain: {
      name: 'BonsaiCctpSourceRouter',
      version: '1',
      chainId: 31337,
      verifyingContract: router,
    },
    types: BRIDGE_INTENT_TYPES,
    primaryType: 'BridgeIntent' as const,
    message: intent,
  };
  const signature = await wallet.signTypedData({ account: accounts[2], ...typed });
  return { intent, signature, typed };
}
async function approve(amount = principal + fee) {
  await write(token, 'TestUsdc', 'approve', [router, amount]);
}

test('Ethereum takes its fee and bridges principal in one mined transaction, preserving destination and user ownership', async () => {
  const q = await quote();
  await approve();
  assert.equal(
    await reader.readContract({
      address: router,
      abi: artifact('BonsaiCctpSourceRouter').abi,
      functionName: 'hashIntent',
      args: [q.intent],
    }),
    hashTypedData(q.typed),
  );
  const receipt = await write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, q.signature]);
  assert.equal(await balance(accounts[0]), 9n * principal - fee);
  assert.equal(await balance(accounts[1]), fee);
  assert.equal(await balance(messenger), principal);
  assert.equal(await balance(router), 0n);
  assert.equal(
    await reader.readContract({
      address: token,
      abi: artifact('TestUsdc').abi,
      functionName: 'allowance',
      args: [router, messenger],
    }),
    0n,
  );
  assert.equal(
    await reader.readContract({
      address: messenger,
      abi: artifact('TestMessenger').abi,
      functionName: 'lastRecipient',
    }),
    q.intent.mintRecipient,
  );
  const events = parseEventLogs({
    abi: artifact('BonsaiCctpSourceRouter').abi,
    eventName: 'SourceBridgeInitiated',
    logs: receipt.logs,
  });
  assert.equal(events.length, 1);
  await assert.rejects(
    write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, q.signature]),
    /IntentAlreadyUsed/,
  );
  assert.equal(await balance(accounts[1]), fee);
});

test('a bridge failure rolls back the fee, principal transfer and consumed intent', async () => {
  const q = await quote();
  await approve();
  await write(messenger, 'TestMessenger', 'setFailure', [true]);
  await assert.rejects(
    write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, q.signature]),
    /bridge failed/,
  );
  assert.equal(await balance(accounts[0]), 10n * principal);
  assert.equal(await balance(accounts[1]), 0n);
  assert.equal(await balance(messenger), 0n);
  assert.equal(
    await reader.readContract({
      address: router,
      abi: artifact('BonsaiCctpSourceRouter').abi,
      functionName: 'consumed',
      args: [q.intent.intentId],
    }),
    false,
  );
});

test('fee-transfer failure and a bridge that does not consume principal both fail atomically', async () => {
  const q = await quote();
  await approve();
  await write(token, 'TestUsdc', 'setBlocked', [accounts[1]]);
  await assert.rejects(
    write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, q.signature]),
    /blocked transfer/,
  );
  await write(token, 'TestUsdc', 'setBlocked', ['0x0000000000000000000000000000000000000000']);
  await write(messenger, 'TestMessenger', 'setSkipBurn', [true]);
  await assert.rejects(
    write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, q.signature]),
    /UnsupportedTokenBehavior/,
  );
  assert.equal(await balance(accounts[0]), 10n * principal);
  assert.equal(await balance(accounts[1]), 0n);
});

test('signed recipient, fee, amount, sender, deadline and EIP-712 deployment/chain cannot be substituted', async () => {
  const q = await quote();
  await approve();
  for (const patch of [
    { mintRecipient: `0x${'99'.repeat(32)}` },
    { principal: principal - 1n },
    { feeBps: 8 },
  ]) {
    await assert.rejects(
      write(router, 'BonsaiCctpSourceRouter', 'bridge', [{ ...q.intent, ...patch }, q.signature]),
    );
  }
  await assert.rejects(
    write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, q.signature], accounts[3]),
  );
  const wrongChain = await wallet.signTypedData({
    account: accounts[2],
    ...q.typed,
    domain: { ...q.typed.domain, chainId: 1 },
  });
  await assert.rejects(write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, wrongChain]));
  const wrongRouter = await wallet.signTypedData({
    account: accounts[2],
    ...q.typed,
    domain: { ...q.typed.domain, verifyingContract: messenger },
  });
  await assert.rejects(write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, wrongRouter]));
  await network.provider.request({ method: 'evm_increaseTime', params: [300] });
  await assert.rejects(write(router, 'BonsaiCctpSourceRouter', 'bridge', [q.intent, q.signature]));
  assert.equal(await balance(accounts[1]), 0n);
});

async function issuePermit(spender: Address, amount: bigint, deadline: bigint) {
  const signature = await wallet.signTypedData({
    account: accounts[0],
    domain: { name: 'Fixture USDC', version: '1', chainId: 31337, verifyingContract: token },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: { owner: accounts[0], spender, value: amount, nonce: 0n, deadline },
  });
  const r = signature.slice(0, 66) as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const v = Number.parseInt(signature.slice(130), 16);
  return { r, s, v };
}

test('native permit permits approval, fee and burn in the single execution transaction', async () => {
  const q = await quote();
  const { r, s, v } = await issuePermit(router, principal + fee, q.intent.deadline);
  await write(router, 'BonsaiCctpSourceRouter', 'bridgeWithPermit', [
    q.intent,
    q.signature,
    q.intent.deadline,
    v,
    r,
    s,
  ]);
  assert.equal(await balance(accounts[1]), fee);
  assert.equal(await balance(messenger), principal);
});

test('half-even rounding matches the fee policy, including ties and the largest bridge amounts', async () => {
  for (const [amount, rate, expected] of [
    [250n, 20, 0n],
    [750n, 20, 2n],
    [1250n, 20, 2n],
    [principal, 12, 1_200_000n],
    [principal, 8, 800_000n],
  ] as const) {
    assert.equal(
      await reader.readContract({
        address: router,
        abi: artifact('BonsaiCctpSourceRouter').abi,
        functionName: 'platformFee',
        args: [amount, rate],
      }),
      expected,
    );
  }
  for (const rate of [20, 12, 8]) {
    const actual = await reader.readContract({
      address: router,
      abi: artifact('BonsaiCctpSourceRouter').abi,
      functionName: 'platformFee',
      args: [MAX_U64, rate],
    });
    assert.equal(
      actual,
      BigInt(
        calculateRoutingFeeAtomicAmount(
          MAX_U64.toString(),
          { mantissa: String(rate), scale: 4 },
          'HALF_EVEN',
        ),
      ),
    );
  }
  const invalid = await quote({ feeBps: 0 });
  await approve();
  await assert.rejects(
    write(router, 'BonsaiCctpSourceRouter', 'bridge', [invalid.intent, invalid.signature]),
  );
});

test('direct Aave supply mints the position to the user with no second platform fee', async () => {
  await write(token, 'TestUsdc', 'approve', [supplyRouter, principal]);
  await write(supplyRouter, 'BonsaiAaveSupplyRouter', 'supply', [principal, principal]);
  assert.equal(await balance(accounts[0], aToken), principal);
  assert.equal(await balance(supplyRouter, aToken), 0n);
  assert.equal(await balance(accounts[1]), 0n);
  assert.equal(await balance(pool), principal);
});

test('a failed lending deposit returns principal through transaction rollback', async () => {
  await write(token, 'TestUsdc', 'approve', [supplyRouter, principal]);
  await write(pool, 'TestPool', 'setFailure', [true]);
  await assert.rejects(
    write(supplyRouter, 'BonsaiAaveSupplyRouter', 'supply', [principal, principal]),
    /pool failed/,
  );
  assert.equal(await balance(accounts[0]), 10n * principal);
  assert.equal(await balance(accounts[0], aToken), 0n);
});

const mintNonce = `0x${'81'.repeat(32)}` as Hex;
function fixtureMessage(recipient = accounts[0], amount = principal) {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }],
    [recipient, amount, mintNonce],
  );
}

test('destination mint and Aave supply execute together, with all receipt tokens owned by the user and no destination platform fee', async () => {
  await write(token, 'TestUsdc', 'approve', [supplyRouter, principal]);
  await write(supplyRouter, 'BonsaiAaveSupplyRouter', 'mintAndSupply', [
    fixtureMessage(),
    '0x01',
    principal,
    principal,
  ]);
  assert.equal(await balance(accounts[0]), 10n * principal);
  assert.equal(await balance(accounts[0], aToken), principal);
  assert.equal(await balance(pool), principal);
  assert.equal(await balance(supplyRouter), 0n);
  assert.equal(await balance(accounts[1]), 0n);
  await assert.rejects(
    write(supplyRouter, 'BonsaiAaveSupplyRouter', 'mintAndSupply', [
      fixtureMessage(),
      '0x01',
      principal,
      principal,
    ]),
    /nonce already used/,
  );
});

test('destination supply failure, wrong mint recipient, wrong amount and invalid attestation leave existing user funds and the mint nonce unchanged', async () => {
  await write(token, 'TestUsdc', 'approve', [supplyRouter, principal]);
  for (const [message, attestation] of [
    [fixtureMessage(accounts[3]), '0x01'],
    [fixtureMessage(accounts[0], principal - 1n), '0x01'],
    [fixtureMessage(), '0x02'],
  ]) {
    await assert.rejects(
      write(supplyRouter, 'BonsaiAaveSupplyRouter', 'mintAndSupply', [
        message,
        attestation,
        principal,
        principal,
      ]),
    );
  }
  await write(pool, 'TestPool', 'setFailure', [true]);
  await assert.rejects(
    write(supplyRouter, 'BonsaiAaveSupplyRouter', 'mintAndSupply', [
      fixtureMessage(),
      '0x01',
      principal,
      principal,
    ]),
    /pool failed/,
  );
  assert.equal(await balance(accounts[0]), 10n * principal);
  assert.equal(await balance(accounts[3]), 0n);
  assert.equal(await balance(accounts[0], aToken), 0n);
  assert.equal(
    await reader.readContract({
      address: transmitter,
      abi: artifact('TestMessageTransmitter').abi,
      functionName: 'used',
      args: [mintNonce],
    }),
    false,
  );
});

test('if a relayer already minted to the user, recovery supplies that USDC without repeating the source or mint', async () => {
  await write(
    transmitter,
    'TestMessageTransmitter',
    'receiveMessage',
    [fixtureMessage(), '0x01'],
    accounts[4],
  );
  await write(token, 'TestUsdc', 'approve', [supplyRouter, principal]);
  await write(supplyRouter, 'BonsaiAaveSupplyRouter', 'supply', [principal, principal]);
  assert.equal(await balance(accounts[0]), 10n * principal);
  assert.equal(await balance(accounts[0], aToken), principal);
  assert.equal(await balance(accounts[1]), 0n);
});

test('destination USDC permit removes the separate approval transaction from mint and Aave supply', async () => {
  const deadline = (await reader.getBlock()).timestamp + 240n;
  const { r, s, v } = await issuePermit(supplyRouter, principal, deadline);
  await write(supplyRouter, 'BonsaiAaveSupplyRouter', 'mintAndSupplyWithPermit', [
    fixtureMessage(),
    '0x01',
    principal,
    principal,
    deadline,
    v,
    r,
    s,
  ]);
  assert.equal(await balance(accounts[0]), 10n * principal);
  assert.equal(await balance(accounts[0], aToken), principal);
  assert.equal(await balance(accounts[1]), 0n);
});
