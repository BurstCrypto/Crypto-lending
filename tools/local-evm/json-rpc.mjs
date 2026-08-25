import http from 'node:http';

import { LOCAL_EVM_MANIFEST } from './manifest.mjs';

const ALLOWED_METHODS = new Set([
  'eth_call',
  'eth_accounts',
  'eth_chainId',
  'eth_getBlockByNumber',
  'eth_getCode',
  'eth_getTransactionReceipt',
  'eth_sendTransaction',
  'evm_mine',
  'evm_revert',
  'evm_snapshot',
  'hardhat_impersonateAccount',
  'hardhat_setCode',
  'web3_clientVersion',
]);
const MAX_RESPONSE_BYTES = 131_072;
let nextRequestId = 1;

export class LocalEvmRpcError extends Error {
  constructor(readonlyCode = 'LOCAL_EVM_RPC_UNAVAILABLE') {
    super(readonlyCode);
    this.name = 'LocalEvmRpcError';
    this.code = readonlyCode;
  }
}

function fail(code) {
  throw new LocalEvmRpcError(code);
}

export function parseLocalEvmRpcResponse(value, id) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('LOCAL_EVM_RPC_INVALID_RESPONSE');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 3 ||
    keys.some((key) => typeof key !== 'string' || !['jsonrpc', 'id', 'result'].includes(key))
  ) {
    return fail('LOCAL_EVM_RPC_INVALID_RESPONSE');
  }
  const record = Object.create(null);
  for (const key of ['jsonrpc', 'id', 'result']) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      return fail('LOCAL_EVM_RPC_INVALID_RESPONSE');
    }
    record[key] = descriptor.value;
  }
  if (record.jsonrpc !== '2.0' || record.id !== id) {
    return fail('LOCAL_EVM_RPC_INVALID_RESPONSE');
  }
  return record.result;
}

export function requestLocalEvm(method, params, options = {}) {
  if (!ALLOWED_METHODS.has(method) || !Array.isArray(params)) {
    return Promise.reject(new LocalEvmRpcError('LOCAL_EVM_RPC_METHOD_FORBIDDEN'));
  }
  const id = nextRequestId;
  nextRequestId += 1;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  if (Buffer.byteLength(body, 'utf8') > 65_536) {
    return Promise.reject(new LocalEvmRpcError('LOCAL_EVM_RPC_REQUEST_TOO_LARGE'));
  }
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 5_000) {
    return Promise.reject(new LocalEvmRpcError('LOCAL_EVM_RPC_INVALID_TIMEOUT'));
  }

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        protocol: 'http:',
        hostname: LOCAL_EVM_MANIFEST.rpc.host,
        port: LOCAL_EVM_MANIFEST.rpc.port,
        path: '/',
        method: 'POST',
        agent: false,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body, 'utf8'),
          connection: 'close',
        },
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          response.headers.location !== undefined ||
          !String(response.headers['content-type'] ?? '').startsWith('application/json')
        ) {
          response.resume();
          reject(new LocalEvmRpcError('LOCAL_EVM_RPC_INVALID_HTTP_RESPONSE'));
          return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            response.destroy(new LocalEvmRpcError('LOCAL_EVM_RPC_RESPONSE_TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', () => reject(new LocalEvmRpcError()));
        response.once('end', () => {
          try {
            resolve(
              parseLocalEvmRpcResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')), id),
            );
          } catch (error) {
            reject(
              error instanceof LocalEvmRpcError
                ? error
                : new LocalEvmRpcError('LOCAL_EVM_RPC_INVALID_RESPONSE'),
            );
          }
        });
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new LocalEvmRpcError()));
    request.once('error', () => reject(new LocalEvmRpcError()));
    request.end(body);
  });
}

export async function assertLocalEvmIdentity() {
  const chainId = await requestLocalEvm('eth_chainId', []);
  const clientVersion = await requestLocalEvm('web3_clientVersion', []);
  if (
    chainId !== LOCAL_EVM_MANIFEST.chainIdHex ||
    typeof clientVersion !== 'string' ||
    !clientVersion.toLowerCase().includes('hardhat')
  ) {
    return fail('LOCAL_EVM_IDENTITY_MISMATCH');
  }
  return Object.freeze({
    runtimeIdentity: LOCAL_EVM_MANIFEST.runtimeIdentity,
    networkId: LOCAL_EVM_MANIFEST.networkId,
  });
}

export async function waitForLocalEvm(options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      return await assertLocalEvmIdentity();
    } catch {
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } while (Date.now() < deadline);
  return fail('LOCAL_EVM_START_TIMEOUT');
}
