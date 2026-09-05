import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
  DECISION_PATH,
  loadValidatedProviderDecisionSnapshot,
  REPOSITORY_ROOT,
  SIDECAR_PATH,
  validateProviderDecisionFiles,
  validateProviderDecisionRecord,
  validateProviderDecisionSidecar,
} from './validate-kan-62-provider-decision.mjs';

const NOW = new Date('2026-08-22T23:59:59.999Z');

function loadDecision() {
  return JSON.parse(readFileSync(`${REPOSITORY_ROOT}/${DECISION_PATH}`, 'utf8'));
}

function validate(record, now = NOW) {
  return validateProviderDecisionRecord(record, { now });
}

function assertMutationRejected(name, mutate) {
  const record = loadDecision();
  mutate(record);
  const errors = validate(record);
  assert.ok(errors.length > 0, `${name} should fail closed`);
}

test('the canonical packet and exact lowercase SHA-256 sidecar are valid but not approved', () => {
  const record = loadDecision();
  assert.deepEqual(validate(record), []);
  const result = validateProviderDecisionFiles({ now: NOW });
  assert.deepEqual(result, {
    errors: [],
    fingerprint: '82876c3e7872f6b2fa604e931e8d226e7740c323fd9632605061f8092efb6924',
  });
  assert.equal(record.externalStatus, 'PENDING_EXTERNAL_APPROVAL');
  assert.equal(record.approvalBoundary.approved, false);
  assert.equal(record.selection.runtimeStatus, 'NOT_APPROVED');
});

test('preflight fields come from one immutable sidecar-validated snapshot', () => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'kan-62-snapshot-'));
  try {
    const decisionPath = resolve(repositoryRoot, DECISION_PATH);
    const sidecarPath = resolve(repositoryRoot, SIDECAR_PATH);
    mkdirSync(dirname(decisionPath), { recursive: true });
    const decisionBytes = readFileSync(`${REPOSITORY_ROOT}/${DECISION_PATH}`);
    writeFileSync(decisionPath, decisionBytes);
    writeFileSync(
      sidecarPath,
      `${createHash('sha256').update(decisionBytes).digest('hex')}\n`,
      'utf8',
    );

    const snapshot = loadValidatedProviderDecisionSnapshot({ repositoryRoot, now: NOW });
    const replacement = JSON.parse(decisionBytes.toString('utf8'));
    replacement.externalStatus = 'APPROVED';
    replacement.selection.runtimeStatus = 'APPROVED';
    replacement.approvalBoundary.approved = true;
    writeFileSync(decisionPath, `${JSON.stringify(replacement)}\n`, 'utf8');

    assert.deepEqual(snapshot.errors, []);
    assert.ok(snapshot.record);
    assert.equal(snapshot.record.externalStatus, 'PENDING_EXTERNAL_APPROVAL');
    assert.equal(snapshot.record.selection.runtimeStatus, 'NOT_APPROVED');
    assert.equal(snapshot.record.approvalBoundary.approved, false);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.record), true);
    assert.equal(Object.isFrozen(snapshot.record.selection), true);
    assert.equal(
      JSON.parse(readFileSync(decisionPath, 'utf8')).externalStatus,
      'APPROVED',
      'the hostile rewrite must replace the controlled file after snapshot validation',
    );
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('malformed JSON values never escape validation as exceptions', () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const malformed = [
    null,
    undefined,
    true,
    42,
    'KAN-62',
    [],
    {},
    { schemaVersion: 1 },
    { ...loadDecision(), selection: null },
    { ...loadDecision(), sourceEvidence: [{ observedFact: 1n }] },
    revoked.proxy,
  ];
  for (const value of malformed) {
    assert.doesNotThrow(() => validate(value));
    assert.ok(validate(value).length > 0);
  }
});

test('every object kind is closed against unknown keys', () => {
  const mutations = [
    (record) => (record.unknown = true),
    (record) => (record.selection.unknown = true),
    (record) => (record.approvalBoundary.unknown = true),
    (record) => (record.gates[0].unknown = true),
    (record) => (record.capabilityBoundary.unknown = true),
    (record) => (record.capabilityBoundary.transportAuthority.unknown = true),
    (record) => (record.methodProfiles[0].unknown = true),
    (record) => (record.chainPolicies[0].unknown = true),
    (record) => (record.chainPolicies[0].freshness.unknown = true),
    (record) => (record.chainPolicies[0].finality.unknown = true),
    (record) => (record.chainPolicies[0].reorg.unknown = true),
    (record) => (record.chainPolicies[0].outage.unknown = true),
    (record) => (record.chainPolicies[0].fallback.unknown = true),
    (record) => (record.networks[0].unknown = true),
    (record) => (record.providerResearch[0].unknown = true),
    (record) => (record.commercialResearch.unknown = true),
    (record) => (record.sourceEvidence[0].unknown = true),
    (record) => (record.zeroCostEvidence.unknown = true),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`unknown object key ${index}`, mutate),
  );
});

test('deleting any chain, network, fallback, or gate is rejected', () => {
  const mutations = [
    (record) => record.chainPolicies.splice(1, 1),
    (record) => record.networks.splice(7, 1),
    (record) => delete record.selection.fallbackProvider,
    (record) => delete record.chainPolicies[0].fallback.provider,
    (record) => record.gates.splice(0, 1),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`closed membership ${index}`, mutate),
  );
});

test('provider roles cannot be swapped, aliased, or collapsed to one provider', () => {
  const mutations = [
    (record) => {
      record.selection.primaryProvider = 'QUICKNODE';
      record.selection.fallbackProvider = 'ALCHEMY';
    },
    (record) => (record.selection.fallbackProvider = 'ALCHEMY'),
    (record) => (record.selection.primaryProvider = 'ALCHEMY_TEAM_ALIAS'),
    (record) => (record.providerResearch[1].proposedRole = 'PRIMARY'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`provider role ${index}`, mutate));
});

test('schema, decision, and method-profile version downgrades are rejected', () => {
  const mutations = [
    (record) => (record.schemaVersion = 0),
    (record) => (record.decisionReference = 'jira:KAN-62/provider-decision-v0'),
    (record) => (record.methodProfiles[0].id = 'EVM_STANDARD_READ_V0'),
    (record) => (record.networks[0].methodProfileId = 'EVM_STANDARD_READ_V0'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`version downgrade ${index}`, mutate),
  );
});

test('latest, Flashblocks, processed, and WebSocket-only observations cannot authorize money', () => {
  const mutations = [
    (record) => (record.chainPolicies[0].finality.financialSignal = 'LATEST_HEAD'),
    (record) => (record.chainPolicies[1].finality.financialSignal = 'ALCHEMY_FLASHBLOCKS'),
    (record) => (record.chainPolicies[3].finality.financialSignal = 'PROCESSED_COMMITMENT'),
    (record) => (record.capabilityBoundary.transportAuthority.webSocketOnlyFinancialAdvance = true),
    (record) => (record.capabilityBoundary.transportAuthority.webSocketRole = 'AUTHORITATIVE'),
    (record) =>
      record.capabilityBoundary.excluded.splice(
        record.capabilityBoundary.excluded.indexOf('ALCHEMY_FLASHBLOCKS'),
        1,
      ),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`unsafe finality ${index}`, mutate));
});

test('arbitrary endpoint hosts, credentials, Regions, plans, SLA, and costs are rejected', () => {
  const mutations = [
    (record) => record.approvalBoundary.endpointHostnames.push('rpc.example.invalid'),
    (record) => record.approvalBoundary.credentialReferences.push('credential-ref:unapproved'),
    (record) => record.approvalBoundary.regions.push('us-east-1'),
    (record) => (record.approvalBoundary.plan = 'FREE'),
    (record) => (record.approvalBoundary.sla = '99.99_PERCENT'),
    (record) => (record.approvalBoundary.monthlyCostUsd = 1),
    (record) => (record.providerResearch[0].approvedSla = 'TEAM_APPROVED'),
    (record) => (record.providerResearch[1].approvedCostUsd = 0),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`unapproved material ${index}`, mutate),
  );
});

test('network identity is fixed independently of provider labels and Solana uses full genesis hashes', () => {
  const mutations = [
    (record) => (record.networks[0].expectedIdentity = 'PROVIDER_SELECTED'),
    (record) => (record.networks[0].caipReferenceDerivation = 'PROVIDER_SELECTED'),
    (record) => (record.networks[3].expectedIdentity = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'),
    (record) => (record.networks[7].expectedIdentity = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1badSuffix'),
    (record) => (record.networks[3].caipReferenceDerivation = 'FULL_HASH_AS_CAIP_REFERENCE'),
    (record) => (record.networks[7].identityMethod = 'providerNetworkName'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`network identity ${index}`, mutate));
});

test('hash and parent/root continuity cannot be removed from reorg handling', () => {
  const mutations = [
    (record) => (record.chainPolicies[0].reorg.lineage = 'PERSIST_HEIGHT_ONLY'),
    (record) => (record.chainPolicies[1].reorg.lineage = 'PERSIST_L2_HEIGHT_ONLY'),
    (record) => (record.chainPolicies[3].reorg.lineage = 'PERSIST_SLOT_ONLY'),
    (record) => (record.chainPolicies[0].reorg.unknownAncestor = 'CONTINUE'),
    (record) => (record.chainPolicies[0].reorg.recovery = 'SKIP_TO_LATEST'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`continuity ${index}`, mutate));
});

test('automatic resubmission, automatic failover, and unsupported capabilities remain fail-closed', () => {
  const mutations = [
    (record) => (record.capabilityBoundary.automaticTransactionResubmission = 'ALLOWED'),
    (record) => (record.capabilityBoundary.failClosedOnUnsupportedCapability = false),
    (record) => (record.chainPolicies[0].outage.automaticProductionFailover = 'ACTIVE'),
    (record) => (record.chainPolicies[0].fallback.activation = 'AUTOMATIC'),
    (record) => record.methodProfiles[0].writeMethods.push('eth_sendRawTransaction'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`unsafe recovery ${index}`, mutate));
});

test('approval aliases, active status, egress, and fabricated live evidence are rejected', () => {
  const mutations = [
    (record) => (record.externalStatus = 'APPROVED'),
    (record) => (record.selection.primaryStatus = 'APPROVED_BY_ARCHITECTURE'),
    (record) => (record.gates[0].status = 'APPROVED_BY_TEAM_ALIAS'),
    (record) => (record.approvalBoundary.approved = true),
    (record) => (record.approvalBoundary.runtimeActivation = 'ACTIVE'),
    (record) => record.approvalBoundary.egressDestinations.push('https://rpc.example.invalid'),
    (record) => (record.zeroCostEvidence.providerAccountsCreated = 1),
    (record) => (record.zeroCostEvidence.trialsStarted = 1),
    (record) => (record.zeroCostEvidence.rpcRequestsSent = 1),
    (record) => (record.zeroCostEvidence.liveEvidenceStatus = 'PASSED'),
  ];
  mutations.forEach((mutate, index) =>
    assertMutationRejected(`fabricated approval ${index}`, mutate),
  );
});

test('KAN-251 and KAN-231 must both remain pending and blocking', () => {
  const mutations = [
    (record) => (record.gates[0].ticket = 'KAN-231'),
    (record) => (record.gates[0].status = 'APPROVED'),
    (record) => (record.gates[1].status = 'COMPLETE'),
    (record) => (record.gates[1].blocks = 'NOTHING'),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`gate ${index}`, mutate));
});

test('research and pricing evidence expires after the closed 30-day window', () => {
  assert.deepEqual(validate(loadDecision(), new Date('2026-09-21T23:59:59.999Z')), []);
  const errors = validate(loadDecision(), new Date('2026-09-22T00:00:00.000Z'));
  assert.ok(errors.some((error) => error.includes('stale after 30 days')));
  assertMutationRejected('pricing freshness extension', (record) => {
    record.commercialResearch.evidenceMaxAgeDays = 365;
  });
  assertMutationRejected('pricing approval', (record) => {
    record.commercialResearch.pricingApproved = true;
  });
});

test('source evidence is exact, official, HTTPS-only, and cannot fabricate claims', () => {
  const mutations = [
    (record) => (record.sourceEvidence[0].url = 'http://www.alchemy.com/docs'),
    (record) => (record.sourceEvidence[0].url = 'https://alchemy.example.invalid/docs'),
    (record) => (record.sourceEvidence[18].url = 'https://user@www.quicknode.com/docs'),
    (record) => (record.sourceEvidence[0].observedFact = 'Alchemy guarantees everything.'),
    (record) => record.sourceEvidence.pop(),
  ];
  mutations.forEach((mutate, index) => assertMutationRejected(`source evidence ${index}`, mutate));
});

test('the sidecar rejects byte drift, uppercase aliases, and filename-bearing formats', () => {
  const bytes = readFileSync(`${REPOSITORY_ROOT}/${DECISION_PATH}`);
  const sidecar = readFileSync(`${REPOSITORY_ROOT}/${SIDECAR_PATH}`, 'utf8');
  assert.deepEqual(validateProviderDecisionSidecar(bytes, sidecar), []);
  assert.ok(
    validateProviderDecisionSidecar(Buffer.concat([bytes, Buffer.from(' ')]), sidecar).length,
  );
  assert.ok(validateProviderDecisionSidecar(bytes, sidecar.toUpperCase()).length);
  assert.ok(validateProviderDecisionSidecar(bytes, `${sidecar.trim()}  decision.json\n`).length);
  assert.doesNotThrow(() => validateProviderDecisionSidecar(null, null));
  assert.ok(validateProviderDecisionSidecar(null, null).length);
});

test('the validator implementation has no network, cloud, subprocess, or provider client path', () => {
  const source = readFileSync(
    `${REPOSITORY_ROOT}/infra/providers/validate-kan-62-provider-decision.mjs`,
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
    'alchemy-sdk',
    '@quicknode',
    '@aws-sdk',
  ]) {
    assert.equal(source.includes(forbidden), false, `validator must not contain ${forbidden}`);
  }
});
