import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';

import { LOCAL_EVM_MANIFEST } from './manifest.mjs';
import {
  LOCAL_EVM_CONTROL_HOST,
  LOCAL_EVM_CONTROL_PORT,
  parseLocalEvmControlRecord,
  readLocalEvmControlRecord,
  removeLegacyLocalEvmState,
  removeLocalEvmControlRecord,
  removeStaleLocalEvmState,
  sameLocalEvmControlRecord,
} from './runtime-state.mjs';

const CONTROL_DOMAIN = 'crypto-lending:local-evm-control:v2';
const MAX_CONTROL_BYTES = 16_384;
const HEX_128 = /^[0-9a-f]{32}$/u;
const HEX_256 = /^[0-9a-f]{64}$/u;
const ACTIONS = new Set(['STATUS', 'RESET', 'STOP', 'SET_BALANCES']);
const REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'runtimeIdentity',
  'launchId',
  'nonce',
  'action',
  'payload',
  'proof',
]);
const RESPONSE_KEYS = Object.freeze([
  'schemaVersion',
  'runtimeIdentity',
  'launchId',
  'nonce',
  'action',
  'status',
  'result',
  'proof',
]);
const CONTROL_SERVER_DRAINS = new WeakMap();

export class LocalEvmControlError extends Error {
  constructor(code = 'LOCAL_EVM_CONTROL_UNAVAILABLE') {
    super(code);
    this.name = 'LocalEvmControlError';
    this.code = code;
  }
}

function exactOwnDataRecord(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_MESSAGE');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_MESSAGE');
  }
  const record = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_MESSAGE');
    }
    record[key] = descriptor.value;
  }
  return record;
}

function message(capability, kind, launchId, nonce, action, statusOrPayload, result) {
  const canonical =
    kind === 'request'
      ? JSON.stringify([CONTROL_DOMAIN, kind, launchId, nonce, action, statusOrPayload])
      : JSON.stringify([CONTROL_DOMAIN, kind, launchId, nonce, action, statusOrPayload, result]);
  return createHmac('sha256', Buffer.from(capability, 'hex'))
    .update(canonical, 'utf8')
    .digest('hex');
}

function safeEqualHex(left, right) {
  if (typeof left !== 'string' || !HEX_256.test(left)) return false;
  const expected = Buffer.from(right, 'hex');
  const actual = Buffer.from(left, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseRequest(value, expectedRecord) {
  const request = exactOwnDataRecord(value, REQUEST_KEYS);
  if (
    request.schemaVersion !== 2 ||
    request.runtimeIdentity !== LOCAL_EVM_MANIFEST.runtimeIdentity ||
    request.launchId !== expectedRecord.launchId ||
    typeof request.nonce !== 'string' ||
    !HEX_128.test(request.nonce) ||
    typeof request.action !== 'string' ||
    !ACTIONS.has(request.action) ||
    !safeEqualHex(
      request.proof,
      message(
        expectedRecord.controlCapability,
        'request',
        request.launchId,
        request.nonce,
        request.action,
        request.payload,
      ),
    )
  ) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_AUTHENTICATION_FAILED');
  }
  return request;
}

function parseResponse(value, request, record) {
  const response = exactOwnDataRecord(value, RESPONSE_KEYS);
  const expectedStatus =
    request.action === 'STATUS' ? record.state : request.action === 'STOP' ? 'STOPPING' : 'RUNNING';
  const result = exactNodeInstanceResult(response.result);
  const invalidNodeInstance =
    request.action === 'RESET'
      ? !HEX_128.test(result.nodeInstanceId) || result.nodeInstanceId === record.nodeInstanceId
      : result.nodeInstanceId !== record.nodeInstanceId;
  if (
    response.schemaVersion !== 2 ||
    response.runtimeIdentity !== LOCAL_EVM_MANIFEST.runtimeIdentity ||
    response.launchId !== record.launchId ||
    response.nonce !== request.nonce ||
    response.action !== request.action ||
    response.status !== expectedStatus ||
    invalidNodeInstance ||
    (response.status === 'RUNNING' && !HEX_128.test(result.nodeInstanceId)) ||
    !safeEqualHex(
      response.proof,
      message(
        record.controlCapability,
        'response',
        response.launchId,
        response.nonce,
        response.action,
        response.status,
        response.result,
      ),
    )
  ) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_RESPONSE');
  }
  return Object.freeze({ status: response.status, nodeInstanceId: result.nodeInstanceId });
}

function exactNodeInstanceResult(value) {
  const result = exactOwnDataRecord(value, ['nodeInstanceId']);
  if (
    result.nodeInstanceId !== null &&
    (typeof result.nodeInstanceId !== 'string' || !HEX_128.test(result.nodeInstanceId))
  ) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_MESSAGE');
  }
  return result;
}

function boundedJsonRequest(record, request, timeoutMs) {
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body, 'utf8') > MAX_CONTROL_BYTES) {
    return Promise.reject(new LocalEvmControlError('LOCAL_EVM_CONTROL_REQUEST_TOO_LARGE'));
  }
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      {
        protocol: 'http:',
        hostname: record.controlHost,
        port: record.controlPort,
        path: '/control',
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
          reject(new LocalEvmControlError('LOCAL_EVM_CONTROL_REJECTED'));
          return;
        }
        const declared = response.headers['content-length'];
        if (
          declared !== undefined &&
          (Array.isArray(declared) ||
            !/^(?:0|[1-9][0-9]*)$/u.test(declared) ||
            Number(declared) > MAX_CONTROL_BYTES)
        ) {
          response.resume();
          reject(new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_RESPONSE'));
          return;
        }
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_CONTROL_BYTES) {
            response.destroy(new LocalEvmControlError('LOCAL_EVM_CONTROL_RESPONSE_TOO_LARGE'));
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', () => reject(new LocalEvmControlError()));
        response.once('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_RESPONSE'));
          }
        });
      },
    );
    outgoing.setTimeout(timeoutMs, () => outgoing.destroy(new LocalEvmControlError()));
    outgoing.once('error', () => reject(new LocalEvmControlError()));
    outgoing.end(body);
  });
}

export async function sendLocalEvmControlCommand(value, action, payload = null, options = {}) {
  const record = parseLocalEvmControlRecord(value);
  if (!ACTIONS.has(action)) throw new LocalEvmControlError('LOCAL_EVM_CONTROL_ACTION_FORBIDDEN');
  if (action !== 'SET_BALANCES' && payload !== null) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_PAYLOAD');
  }
  const timeoutMs = options.timeoutMs ?? (action === 'STATUS' ? 2_000 : 15_000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 20_000) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_TIMEOUT');
  }
  const nonce = randomBytes(16).toString('hex');
  const request = Object.freeze({
    schemaVersion: 2,
    runtimeIdentity: LOCAL_EVM_MANIFEST.runtimeIdentity,
    launchId: record.launchId,
    nonce,
    action,
    payload,
    proof: message(record.controlCapability, 'request', record.launchId, nonce, action, payload),
  });
  return parseResponse(await boundedJsonRequest(record, request, timeoutMs), request, record);
}

function rejectRequest(response, statusCode = 403) {
  if (response.headersSent) return response.destroy();
  const body = '{"error":"LOCAL_EVM_CONTROL_REJECTED"}';
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body, 'utf8'),
    connection: 'close',
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readBoundedRequest(request) {
  const length = request.headers['content-length'];
  if (
    request.method !== 'POST' ||
    request.url !== '/control' ||
    request.socket.remoteAddress !== LOCAL_EVM_CONTROL_HOST ||
    request.headers.host !== `${LOCAL_EVM_CONTROL_HOST}:${LOCAL_EVM_CONTROL_PORT}` ||
    !String(request.headers['content-type'] ?? '').startsWith('application/json') ||
    request.headers['content-encoding'] !== undefined ||
    request.headers['transfer-encoding'] !== undefined ||
    typeof length !== 'string' ||
    !/^[1-9][0-9]*$/u.test(length) ||
    Number(length) > MAX_CONTROL_BYTES
  ) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_REQUEST');
  }
  const expectedLength = Number(length);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_CONTROL_BYTES || size > expectedLength) {
      throw new LocalEvmControlError('LOCAL_EVM_CONTROL_REQUEST_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  if (size !== expectedLength) {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_REQUEST');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new LocalEvmControlError('LOCAL_EVM_CONTROL_INVALID_REQUEST');
  }
}

export async function startLocalEvmControlServer(options) {
  const seenNonces = new Set();
  let operationInProgress = false;
  let activeHandlers = 0;
  const drainWaiters = new Set();
  const server = http.createServer((request, response) => {
    activeHandlers += 1;
    void (async () => {
      let lockAcquired = false;
      let retainLock = false;
      request.setTimeout(2_000, () => request.destroy());
      response.setHeader('cache-control', 'no-store');
      try {
        const memoryRecord = parseLocalEvmControlRecord(options.getRecord());
        const diskRecord = readLocalEvmControlRecord();
        if (diskRecord === null || !sameLocalEvmControlRecord(memoryRecord, diskRecord)) {
          throw new LocalEvmControlError('LOCAL_EVM_CONTROL_OWNERSHIP_MISMATCH');
        }
        const parsed = parseRequest(await readBoundedRequest(request), memoryRecord);
        const mutating = parsed.action !== 'STATUS';
        if (memoryRecord.state !== 'RUNNING' && mutating) {
          throw new LocalEvmControlError('LOCAL_EVM_CONTROL_TRANSITION_IN_PROGRESS');
        }
        if (seenNonces.has(parsed.nonce) || (mutating && operationInProgress)) {
          throw new LocalEvmControlError('LOCAL_EVM_CONTROL_REPLAY_OR_BUSY');
        }
        seenNonces.add(parsed.nonce);
        if (seenNonces.size > 256) seenNonces.delete(seenNonces.values().next().value);

        if (mutating) {
          operationInProgress = true;
          lockAcquired = true;
        }
        try {
          await options.handleCommand(parsed.action, parsed.payload);
          retainLock = parsed.action === 'STOP';
        } finally {
          if (lockAcquired && !retainLock) {
            operationInProgress = false;
            lockAcquired = false;
          }
        }

        const updatedMemoryRecord = parseLocalEvmControlRecord(options.getRecord());
        const updatedDiskRecord = readLocalEvmControlRecord();
        const expectedState =
          parsed.action === 'STATUS'
            ? memoryRecord.state
            : parsed.action === 'STOP'
              ? 'STOPPING'
              : 'RUNNING';
        const validInstanceTransition =
          parsed.action === 'RESET'
            ? typeof updatedMemoryRecord.nodeInstanceId === 'string' &&
              HEX_128.test(updatedMemoryRecord.nodeInstanceId) &&
              updatedMemoryRecord.nodeInstanceId !== memoryRecord.nodeInstanceId
            : updatedMemoryRecord.nodeInstanceId === memoryRecord.nodeInstanceId;
        if (
          updatedDiskRecord === null ||
          !sameLocalEvmControlRecord(updatedMemoryRecord, updatedDiskRecord) ||
          updatedMemoryRecord.state !== expectedState ||
          updatedMemoryRecord.launchId !== memoryRecord.launchId ||
          updatedMemoryRecord.controlCapability !== memoryRecord.controlCapability ||
          !validInstanceTransition
        ) {
          throw new LocalEvmControlError('LOCAL_EVM_CONTROL_OWNERSHIP_MISMATCH');
        }
        const status = expectedState;
        const result = Object.freeze({ nodeInstanceId: updatedMemoryRecord.nodeInstanceId });
        const responseBody = JSON.stringify({
          schemaVersion: 2,
          runtimeIdentity: LOCAL_EVM_MANIFEST.runtimeIdentity,
          launchId: memoryRecord.launchId,
          nonce: parsed.nonce,
          action: parsed.action,
          status,
          result,
          proof: message(
            memoryRecord.controlCapability,
            'response',
            memoryRecord.launchId,
            parsed.nonce,
            parsed.action,
            status,
            result,
          ),
        });
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(responseBody, 'utf8'),
          connection: 'close',
          'cache-control': 'no-store',
        });
        if (parsed.action === 'STOP') {
          let acknowledged = false;
          const acknowledge = () => {
            if (acknowledged) return;
            acknowledged = true;
            options.onStopAcknowledged();
          };
          response.once('finish', acknowledge);
          response.once('close', acknowledge);
        }
        response.end(responseBody);
      } catch {
        if (lockAcquired && !retainLock) operationInProgress = false;
        rejectRequest(response);
      }
    })()
      .catch(() => rejectRequest(response))
      .finally(() => {
        activeHandlers -= 1;
        if (activeHandlers === 0) {
          for (const resolve of drainWaiters) resolve();
          drainWaiters.clear();
        }
      });
  });
  CONTROL_SERVER_DRAINS.set(server, () =>
    activeHandlers === 0
      ? Promise.resolve()
      : new Promise((resolve) => {
          drainWaiters.add(resolve);
        }),
  );
  server.maxConnections = 16;
  server.requestTimeout = 2_000;
  server.headersTimeout = 2_000;
  server.keepAliveTimeout = 100;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(LOCAL_EVM_CONTROL_PORT, LOCAL_EVM_CONTROL_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (
    typeof address !== 'object' ||
    address === null ||
    address.address !== LOCAL_EVM_CONTROL_HOST ||
    address.port !== LOCAL_EVM_CONTROL_PORT ||
    address.family !== 'IPv4'
  ) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('Local EVM control server did not bind the exact loopback endpoint');
  }
  return server;
}

/** Stops admission and waits for every admitted handler, even if its socket closed early. */
export async function closeLocalEvmControlServerAndDrain(server) {
  const waitForHandlers = CONTROL_SERVER_DRAINS.get(server);
  if (typeof waitForHandlers !== 'function') {
    throw new TypeError('Invalid local EVM control server');
  }
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  await waitForHandlers();
  CONTROL_SERVER_DRAINS.delete(server);
}

export function probeLoopbackPort(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? 500;
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: LOCAL_EVM_CONTROL_HOST, port });
    let completed = false;
    const finish = (occupied) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(timeoutMs, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', (error) => finish(error?.code !== 'ECONNREFUSED'));
  });
}

export async function localEvmEndpointsAreAbsent() {
  const [rpcOccupied, controlOccupied] = await Promise.all([
    probeLoopbackPort(LOCAL_EVM_MANIFEST.rpc.port),
    probeLoopbackPort(LOCAL_EVM_CONTROL_PORT),
  ]);
  return !rpcOccupied && !controlOccupied;
}

async function bindLoopbackGuard(port) {
  const server = net.createServer((socket) => socket.destroy());
  server.maxConnections = 4;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, LOCAL_EVM_CONTROL_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (
      typeof address !== 'object' ||
      address === null ||
      address.address !== LOCAL_EVM_CONTROL_HOST ||
      address.port !== port ||
      address.family !== 'IPv4'
    ) {
      throw new Error('Local EVM stale-state guard bound an unexpected endpoint');
    }
    return server;
  } catch {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    return null;
  }
}

async function closeGuard(server) {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
}

/** Atomically clears only state whose two fixed ownership endpoints can both be guarded. */
export async function clearProvenStaleLocalEvmState(expected, options = {}) {
  const controlGuard = await bindLoopbackGuard(LOCAL_EVM_CONTROL_PORT);
  if (controlGuard === null) return false;
  const rpcGuard = await bindLoopbackGuard(LOCAL_EVM_MANIFEST.rpc.port);
  if (rpcGuard === null) {
    await closeGuard(controlGuard);
    return false;
  }
  try {
    if (expected !== undefined) {
      if (!removeLocalEvmControlRecord(expected)) return false;
      removeLegacyLocalEvmState();
    } else if (options.invalidRecord === true) {
      removeStaleLocalEvmState();
    } else {
      removeLegacyLocalEvmState();
    }
    return true;
  } finally {
    await closeGuard(rpcGuard);
    await closeGuard(controlGuard);
  }
}
