import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CAPTURE_PATH,
  REPOSITORY_ROOT,
  SIDECAR_PATH,
  validateProviderResearchCaptureFiles,
  validateProviderResearchCaptureRecord,
  validateProviderResearchCaptureSidecar,
} from './validate-active-provider-research-captures.mjs';

const EXPECTED_FINGERPRINT = 'db13db3ff78d6dd0641f8f61067e48d8eb45d0eab309491e2bff9a60112a97d2';

function loadCapture() {
  return JSON.parse(readFileSync(`${REPOSITORY_ROOT}/${CAPTURE_PATH}`, 'utf8'));
}

function assertMutationRejected(name, mutate) {
  const capture = loadCapture();
  mutate(capture);
  const errors = validateProviderResearchCaptureRecord(capture);
  assert.ok(errors.length > 0, `${name} should fail closed`);
}

test('the canonical four-provider research packet is valid and remains non-operational', () => {
  const capture = loadCapture();
  assert.deepEqual(validateProviderResearchCaptureRecord(capture), []);
  assert.deepEqual(validateProviderResearchCaptureFiles(), {
    errors: [],
    fingerprint: EXPECTED_FINGERPRINT,
  });
  assert.deepEqual(
    capture.providers.map(({ providerId }) => providerId),
    ['compound', 'euler', 'gearbox', 'jupiter'],
  );
  for (const provider of capture.providers) {
    assert.deepEqual(provider.status, {
      research: 'CATALOGED_OFFLINE_RESEARCH_ONLY',
      integration: 'DORMANT_UNREGISTERED',
      availability: 'UNAVAILABLE',
      approval: 'NOT_APPROVED',
      risk: 'NOT_ASSESSED',
      independentReview: 'NOT_PERFORMED',
      liveEvidence: 'NOT_COLLECTED',
      supportedActions: [],
      mayAuthorizeFinancialAction: false,
    });
  }
});

test('malformed, accessor-bearing, and non-JSON values fail closed without escaping', () => {
  const accessor = {};
  Object.defineProperty(accessor, 'schemaVersion', {
    enumerable: true,
    get() {
      throw new Error('must not execute');
    },
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const malformed = [null, undefined, true, 1, 'capture', [], {}, accessor, revoked.proxy];
  for (const value of malformed) {
    assert.doesNotThrow(() => validateProviderResearchCaptureRecord(value));
    assert.ok(validateProviderResearchCaptureRecord(value).length > 0);
  }
});

test('schema membership and all nested objects are closed against drift', () => {
  const mutations = [
    (capture) => (capture.unknown = true),
    (capture) => (capture.capturedAt = '2026-09-04T15:39:48Z'),
    (capture) => (capture.capturedOn = '2026-09-05'),
    (capture) => (capture.scope.unknown = true),
    (capture) => (capture.providers[0].unknown = true),
    (capture) => (capture.providers[0].network.unknown = true),
    (capture) => (capture.providers[0].status.unknown = true),
    (capture) => (capture.providers[0].sources[0].unknown = true),
    (capture) => (capture.providers[0].identifiers[0].unknown = true),
    (capture) => (capture.zeroCostEvidence.unknown = true),
    (capture) => capture.providers.pop(),
    (capture) => capture.providers.reverse(),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`closed schema ${index}`, mutate));
});

test('Base, BNB Smart Chain, and testnet substitutions are rejected', () => {
  const mutations = [
    (capture) => {
      capture.providers[0].network = {
        networkId: 'eip155:8453',
        name: 'Base',
        ecosystem: 'EVM',
        environment: 'MAINNET',
      };
    },
    (capture) => {
      capture.providers[1].network = {
        networkId: 'eip155:56',
        name: 'BNB Smart Chain',
        ecosystem: 'EVM',
        environment: 'MAINNET',
      };
    },
    (capture) => (capture.providers[2].network.environment = 'TESTNET'),
    (capture) => (capture.providers[3].network.environment = 'DEVNET'),
    (capture) =>
      (capture.providers[3].network.networkId = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'),
    (capture) => (capture.providers[0].sources[0].path = 'deployments/base/usdc/roots.json'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`wrong chain ${index}`, mutate));
});

test('research cannot be relabeled as approval, availability, live evidence, or an action', () => {
  const mutations = [
    (capture) => (capture.scope.researchOnly = false),
    (capture) => (capture.scope.runtimeRegistration = 'PRESENT'),
    (capture) => (capture.scope.liveEvidenceStatus = 'PASSED'),
    (capture) => (capture.providers[0].status.research = 'PRODUCTION_READY'),
    (capture) => (capture.providers[0].status.integration = 'ACTIVE'),
    (capture) => (capture.providers[0].status.availability = 'AVAILABLE'),
    (capture) => (capture.providers[0].status.approval = 'APPROVED'),
    (capture) => (capture.providers[0].status.risk = 'APPROVED'),
    (capture) => (capture.providers[0].status.liveEvidence = 'COLLECTED'),
    (capture) => capture.providers[0].status.supportedActions.push('SUPPLY'),
    (capture) => (capture.providers[0].status.mayAuthorizeFinancialAction = true),
    (capture) => (capture.zeroCostEvidence.rpcRequestsSent = 1),
    (capture) => (capture.zeroCostEvidence.providerCredentialsUsed = 1),
    (capture) => (capture.zeroCostEvidence.transactionsSubmitted = 1),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`unsafe status ${index}`, mutate));
});

test('official source origins, immutable commits, paths, hashes, and facts are exact', () => {
  const mutations = [
    (capture) =>
      (capture.providers[0].officialDocumentationUrls[0] = 'http://docs.compound.finance/'),
    (capture) =>
      (capture.providers[0].officialDocumentationUrls[0] =
        'https://docs.compound.finance.evil.example/'),
    (capture) =>
      (capture.providers[0].sources[0].repositoryUrl = 'https://github.com/example/comet'),
    (capture) => (capture.providers[0].sources[0].url += '?ref=main'),
    (capture) => (capture.providers[0].sources[0].commitSha = '0'.repeat(40)),
    (capture) => (capture.providers[0].sources[0].contentSha256 = '0'.repeat(64)),
    (capture) => (capture.providers[0].sources[0].contentByteLength += 1),
    (capture) => (capture.providers[0].sources[0].observedFacts[0] = 'Everything is approved.'),
    (capture) => capture.providers[3].sources.pop(),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`source drift ${index}`, mutate));
});

test('deployment identifiers are closed, chain-typed, unique, and source-bound', () => {
  const mutations = [
    (capture) =>
      (capture.providers[0].identifiers[0].value = '0x0000000000000000000000000000000000000001'),
    (capture) => (capture.providers[0].identifiers[0].kind = 'SOLANA_PROGRAM'),
    (capture) => (capture.providers[0].identifiers[0].sourceId = 'UNKNOWN_SOURCE'),
    (capture) => capture.providers[1].identifiers.pop(),
    (capture) =>
      (capture.providers[3].identifiers[0].value = capture.providers[3].identifiers[1].value),
    (capture) => (capture.providers[3].identifiers[0].value = 'not-base58'),
    (capture) => capture.providers[3].identifiers.reverse(),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`identifier drift ${index}`, mutate));
});

test('explicit unresolved production fields cannot be removed or softened', () => {
  const mutations = [
    (capture) => capture.providers[0].unresolvedFields.pop(),
    (capture) => (capture.providers[1].unresolvedFields[0] = 'RESOLVED'),
    (capture) => capture.providers[2].unresolvedFields.reverse(),
    (capture) => capture.programWideUnresolvedFields.pop(),
    (capture) => (capture.programWideUnresolvedFields[0] = 'APPROVED'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`unresolved field ${index}`, mutate));
});

test('the lowercase sidecar binds the exact capture bytes', () => {
  const bytes = readFileSync(`${REPOSITORY_ROOT}/${CAPTURE_PATH}`);
  const sidecar = readFileSync(`${REPOSITORY_ROOT}/${SIDECAR_PATH}`, 'utf8');
  assert.deepEqual(validateProviderResearchCaptureSidecar(bytes, sidecar), []);
  assert.ok(
    validateProviderResearchCaptureSidecar(Buffer.concat([bytes, Buffer.from(' ')]), sidecar)
      .length > 0,
  );
  assert.ok(validateProviderResearchCaptureSidecar(bytes, sidecar.toUpperCase()).length > 0);
  assert.ok(
    validateProviderResearchCaptureSidecar(bytes, `${sidecar.trim()}  capture.json\n`).length > 0,
  );
  assert.doesNotThrow(() => validateProviderResearchCaptureSidecar(null, null));
  assert.ok(validateProviderResearchCaptureSidecar(null, null).length > 0);
});

test('the validator has no network, provider client, cloud, credential, or subprocess path', () => {
  const source = readFileSync(
    `${REPOSITORY_ROOT}/infra/providers/validate-active-provider-research-captures.mjs`,
    'utf8',
  );
  for (const forbidden of [
    'node:http',
    'node:https',
    'node:net',
    'node:tls',
    'node:dns',
    'node:child_process',
    'fetch(',
    'new WebSocket',
    'sendTransaction',
    'eth_call',
    '@aws-sdk',
    '@solana/web3.js',
    'ethers',
    'viem',
  ]) {
    assert.equal(source.includes(forbidden), false, `validator must not contain ${forbidden}`);
  }
});
