import { encodeFunctionData, isAddress, numberToHex } from 'viem';

import { LOCAL_EVM_MUTATION_CONTROLLER } from './evm-bytecode.mjs';
import { assertLocalEvmIdentity, requestLocalEvm } from './json-rpc.mjs';
import { LOCAL_EVM_MANIFEST } from './manifest.mjs';

const MAX_UINT256 = (1n << 256n) - 1n;
const BLOCK_HASH = /^0x[0-9a-f]{64}$/u;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/u;
const HEX_WORD = /^0x[0-9a-f]{64}$/u;
const BALANCE_OF_ABI = Object.freeze([
  Object.freeze({
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: Object.freeze([Object.freeze({ name: 'account', type: 'address' })]),
    outputs: Object.freeze([Object.freeze({ name: 'balance', type: 'uint256' })]),
  }),
]);
const SET_BALANCE_ABI = Object.freeze([
  Object.freeze({
    type: 'function',
    name: 'setBalance',
    stateMutability: 'nonpayable',
    inputs: Object.freeze([
      Object.freeze({ name: 'account', type: 'address' }),
      Object.freeze({ name: 'balance', type: 'uint256' }),
    ]),
    outputs: Object.freeze([]),
  }),
]);

function parseBlockIdentity(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid local EVM block');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const number = descriptors.number;
  const hash = descriptors.hash;
  if (
    !number ||
    !('value' in number) ||
    typeof number.value !== 'string' ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(number.value) ||
    !hash ||
    !('value' in hash) ||
    typeof hash.value !== 'string' ||
    !BLOCK_HASH.test(hash.value)
  ) {
    throw new TypeError('Invalid local EVM block');
  }
  return Object.freeze({ number: BigInt(number.value), hash: hash.value });
}

async function blockIdentity(selector = 'latest') {
  return parseBlockIdentity(await requestLocalEvm('eth_getBlockByNumber', [selector, false]));
}

async function mineNextBlock(previous) {
  const result = await requestLocalEvm('evm_mine', []);
  if (result !== '0') throw new TypeError('Invalid local EVM mine response');
  const current = await blockIdentity();
  if (current.number !== previous.number + 1n || current.hash === previous.hash) {
    throw new TypeError('Local EVM mutation did not advance the chain');
  }
  return current;
}

function exactBalance(value) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_UINT256) {
    throw new TypeError('Invalid local EVM fixture balance');
  }
  return value;
}

function exactSeedRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid local EVM fixture seed');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== 'string' || !['walletAddress', 'balances'].includes(key))
  ) {
    throw new TypeError('Invalid local EVM fixture seed');
  }
  const wallet = descriptors.walletAddress;
  const balances = descriptors.balances;
  if (
    !wallet ||
    !('value' in wallet) ||
    wallet.enumerable !== true ||
    !balances ||
    !('value' in balances) ||
    balances.enumerable !== true
  ) {
    throw new TypeError('Invalid local EVM fixture seed');
  }
  return Object.freeze({ walletAddress: wallet.value, balances: balances.value });
}

function exactBalances(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid local EVM fixture balances');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const balanceKeys = Reflect.ownKeys(descriptors);
  const stablecoins = LOCAL_EVM_MANIFEST.assets.map(({ stablecoin }) => stablecoin);
  if (
    balanceKeys.length !== stablecoins.length ||
    balanceKeys.some((key) => typeof key !== 'string' || !stablecoins.includes(key)) ||
    stablecoins.some((stablecoin) => {
      const descriptor = descriptors[stablecoin];
      return !descriptor || !('value' in descriptor) || descriptor.enumerable !== true;
    })
  ) {
    throw new TypeError('Invalid local EVM fixture balances');
  }
  return Object.freeze(
    Object.fromEntries(
      stablecoins.map((stablecoin) => [stablecoin, exactBalance(descriptors[stablecoin].value)]),
    ),
  );
}

function normalizeSeeds(seeds) {
  if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 32) {
    throw new TypeError('Invalid local EVM fixture seeds');
  }
  const seen = new Set();
  return Object.freeze(
    seeds.map((seed) => {
      const record = exactSeedRecord(seed);
      if (
        typeof record.walletAddress !== 'string' ||
        !isAddress(record.walletAddress, { strict: true }) ||
        record.walletAddress.toLowerCase() === `0x${'0'.repeat(40)}`
      ) {
        throw new TypeError('Invalid local EVM fixture wallet');
      }
      const walletAddress = record.walletAddress.toLowerCase();
      if (seen.has(walletAddress)) throw new TypeError('Duplicate local EVM fixture wallet');
      seen.add(walletAddress);
      return Object.freeze({ walletAddress, balances: exactBalances(record.balances) });
    }),
  );
}

async function readBalance(contractAddress, walletAddress, blockTag) {
  const result = await requestLocalEvm('eth_call', [
    {
      to: contractAddress,
      data: encodeFunctionData({
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [walletAddress],
      }),
    },
    blockTag,
  ]);
  if (typeof result !== 'string' || !HEX_WORD.test(result)) {
    throw new TypeError('Invalid local EVM fixture balance response');
  }
  return BigInt(result);
}

function receiptData(value, transactionHash, contractAddress) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid local EVM transaction receipt');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const data = Object.create(null);
  for (const key of [
    'transactionHash',
    'status',
    'from',
    'to',
    'blockNumber',
    'blockHash',
    'contractAddress',
    'effectiveGasPrice',
  ]) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError('Invalid local EVM transaction receipt');
    }
    data[key] = descriptor.value;
  }
  if (
    data.transactionHash !== transactionHash ||
    data.status !== '0x1' ||
    typeof data.from !== 'string' ||
    data.from.toLowerCase() !== LOCAL_EVM_MUTATION_CONTROLLER ||
    typeof data.to !== 'string' ||
    data.to.toLowerCase() !== contractAddress ||
    typeof data.blockNumber !== 'string' ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(data.blockNumber) ||
    typeof data.blockHash !== 'string' ||
    !BLOCK_HASH.test(data.blockHash) ||
    data.contractAddress !== null ||
    data.effectiveGasPrice !== '0x0'
  ) {
    throw new TypeError('Invalid local EVM transaction receipt');
  }
  return Object.freeze({
    transactionHash,
    blockNumber: BigInt(data.blockNumber),
    blockHash: data.blockHash,
  });
}

async function sendBalanceTransaction(contractAddress, walletAddress, balance) {
  const transactionHash = await requestLocalEvm('eth_sendTransaction', [
    {
      from: LOCAL_EVM_MUTATION_CONTROLLER,
      to: contractAddress,
      gas: numberToHex(100_000),
      gasPrice: '0x0',
      value: '0x0',
      data: encodeFunctionData({
        abi: SET_BALANCE_ABI,
        functionName: 'setBalance',
        args: [walletAddress, balance],
      }),
    },
  ]);
  if (typeof transactionHash !== 'string' || !TRANSACTION_HASH.test(transactionHash)) {
    throw new TypeError('Invalid local EVM transaction hash');
  }
  return receiptData(
    await requestLocalEvm('eth_getTransactionReceipt', [transactionHash]),
    transactionHash,
    contractAddress,
  );
}

/** The supervisor calls this only before publishing a fresh child as owned. */
export async function initializeFreshLocalEvm() {
  await assertLocalEvmIdentity();
  const accounts = await requestLocalEvm('eth_accounts', []);
  if (!Array.isArray(accounts) || accounts.length !== 0) {
    throw new TypeError('Fresh local EVM exposed accounts');
  }
  const genesis = await blockIdentity();
  if (genesis.number !== 0n) throw new TypeError('Local EVM child was not freshly spawned');
  for (const asset of LOCAL_EVM_MANIFEST.assets) {
    const before = await requestLocalEvm('eth_getCode', [asset.contractAddress, 'latest']);
    if (before !== '0x') throw new TypeError('Fresh local EVM already contained fixture code');
    const result = await requestLocalEvm('hardhat_setCode', [
      asset.contractAddress,
      LOCAL_EVM_MANIFEST.mockStablecoinRuntimeBytecode,
    ]);
    if (result !== true) throw new TypeError('Local EVM fixture code installation failed');
  }
  const impersonated = await requestLocalEvm('hardhat_impersonateAccount', [
    LOCAL_EVM_MUTATION_CONTROLLER,
  ]);
  if (impersonated !== true) throw new TypeError('Local EVM controller initialization failed');
  const afterController = await requestLocalEvm('eth_accounts', []);
  if (!Array.isArray(afterController) || afterController.length !== 0) {
    throw new TypeError('Local EVM controller was exposed as an account');
  }
  const published = await mineNextBlock(genesis);
  await assertSeededContractCode(numberToHex(published.number));
  return published;
}

export async function assertSeededContractCode(blockTag = 'latest') {
  await assertLocalEvmIdentity();
  if (typeof blockTag !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$|^latest$/u.test(blockTag)) {
    throw new TypeError('Invalid local EVM block tag');
  }
  for (const asset of LOCAL_EVM_MANIFEST.assets) {
    const code = await requestLocalEvm('eth_getCode', [asset.contractAddress, blockTag]);
    if (code !== LOCAL_EVM_MANIFEST.mockStablecoinRuntimeBytecode) {
      throw new TypeError('Local EVM fixture contract is not seeded');
    }
  }
}

export async function seedLocalEvmWallets(seeds) {
  const normalized = normalizeSeeds(seeds);
  await assertLocalEvmIdentity();
  const previous = await blockIdentity();
  await assertSeededContractCode(numberToHex(previous.number));
  const transactions = [];
  let published = previous;
  for (const seed of normalized) {
    for (const asset of LOCAL_EVM_MANIFEST.assets) {
      const before = await blockIdentity();
      if (before.number !== published.number || before.hash !== published.hash) {
        throw new TypeError('Local EVM chain changed before fixture transaction');
      }
      const blockTag = numberToHex(before.number);
      const priorBalance = await readBalance(asset.contractAddress, seed.walletAddress, blockTag);
      const receipt = await sendBalanceTransaction(
        asset.contractAddress,
        seed.walletAddress,
        seed.balances[asset.stablecoin],
      );
      published = await blockIdentity();
      if (
        receipt.blockNumber !== before.number + 1n ||
        receipt.blockNumber !== published.number ||
        receipt.blockHash !== published.hash ||
        published.hash === before.hash
      ) {
        throw new TypeError('Local EVM fixture transaction did not mine coherently');
      }
      const preserved = await blockIdentity(blockTag);
      if (preserved.number !== before.number || preserved.hash !== before.hash) {
        throw new TypeError('Local EVM fixture transaction changed observed history');
      }
      await assertSeededContractCode(blockTag);
      if (
        (await readBalance(asset.contractAddress, seed.walletAddress, blockTag)) !== priorBalance
      ) {
        throw new TypeError('Local EVM fixture transaction changed observed history');
      }
      const publishedTag = numberToHex(published.number);
      if (
        (await readBalance(asset.contractAddress, seed.walletAddress, publishedTag)) !==
        seed.balances[asset.stablecoin]
      ) {
        throw new TypeError('Local EVM fixture transaction did not publish its balance');
      }
      await assertSeededContractCode(publishedTag);
      transactions.push(receipt);
    }
  }
  const accounts = await requestLocalEvm('eth_accounts', []);
  if (!Array.isArray(accounts) || accounts.length !== 0) {
    throw new TypeError('Local EVM fixture mutation exposed accounts');
  }
  return Object.freeze({ previous, published, transactions: Object.freeze(transactions) });
}

export async function seedLocalEvmWallet(walletAddress, balances) {
  return seedLocalEvmWallets([Object.freeze({ walletAddress, balances })]);
}
