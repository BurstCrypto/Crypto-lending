import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

// This module is intentionally an offline protocol model. It can reject malformed
// transitions and produce deterministic artifacts, but it cannot observe or mutate
// a durable chain head and therefore never grants a production/CAS/execution brand.

const SCHEMA_VERSION = 1;
const STATE_ARTIFACT = 'PRODUCTION_DEPLOYMENT_CHAIN_STATE_V1';
const RESERVATION_ARTIFACT = 'PRODUCTION_DEPLOYMENT_CHAIN_RESERVATION_V1';
const RESULT_ARTIFACT = 'PRODUCTION_DEPLOYMENT_CHAIN_RESULT_V1';
const RECEIPT_ARTIFACT = 'PRODUCTION_DEPLOYMENT_CHAIN_COMMIT_RECEIPT_V1';
const ZERO_SHA256 = '0'.repeat(64);
const MAX_SEQUENCE = 2_147_483_647;
const MAX_FENCING_TOKEN = 9_223_372_036_854_775_807n;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FENCING_TOKEN_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const OPERATIONS = Object.freeze([
  'PROVISION_INERT',
  'ABORT_PROVISION',
  'ACTIVATE_READ_ONLY',
  'UPDATE_READ_ONLY',
  'ROLLBACK',
  'EMERGENCY_KILL',
  'DELETE',
]);
const OPERATION_SET = new Set(OPERATIONS);
const OUTCOME_SET = new Set(['APPLIED', 'NOT_APPLIED']);

function fail(message) {
  throw new Error(message);
}

function dataRecord(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be a plain data object`);
  }

  return value;
}

function exactRecord(value, label, expectedKeys) {
  const record = dataRecord(value, label);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) {
    fail(`${label} must not contain symbol keys`);
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      descriptor.enumerable !== true
    ) {
      fail(`${label}.${key} must be an enumerable data property`);
    }
  }
  const sortedActual = [...keys].sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((key, index) => key !== sortedExpected[index])
  ) {
    fail(`${label} must contain exactly: ${sortedExpected.join(', ')}`);
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail(`${label} must be a non-empty trimmed string`);
  }
  return value;
}

function sha256(value, label, { zeroAllowed = false } = {}) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 value`);
  }
  if (!zeroAllowed && value === ZERO_SHA256) {
    fail(`${label} must not be the zero SHA-256 value`);
  }
  return value;
}

function sequence(value, label, { zeroAllowed = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (zeroAllowed ? 0 : 1) || value > MAX_SEQUENCE) {
    fail(`${label} must be a bounded integer sequence`);
  }
  return value;
}

function fencingToken(value, label, { zeroAllowed = false } = {}) {
  if (typeof value !== 'string' || !FENCING_TOKEN_PATTERN.test(value)) {
    fail(`${label} must be a canonical decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_FENCING_TOKEN || (!zeroAllowed && parsed === 0n)) {
    fail(`${label} must be a bounded non-zero fencing token`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    fail(`${label} must be a canonical millisecond UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${label} must be a real canonical timestamp`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') {
    fail(`${label} must be a boolean`);
  }
  return value;
}

function operation(value, label) {
  if (typeof value !== 'string' || !OPERATION_SET.has(value)) {
    fail(`${label} must be a supported deployment operation`);
  }
  return value;
}

function assertOperationSequence(value, operationValue, label) {
  if (
    (value === 1 && operationValue !== 'PROVISION_INERT' && operationValue !== 'ABORT_PROVISION') ||
    (value !== 1 && (operationValue === 'PROVISION_INERT' || operationValue === 'ABORT_PROVISION'))
  ) {
    fail(`${label} is not valid at deployment sequence ${value}`);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      fail('canonical JSON numbers must be safe integers');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const record = dataRecord(value, 'canonical JSON value');
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) {
    fail('canonical JSON objects must not contain symbol keys');
  }
  return `{${keys
    .sort()
    .map((key) => {
      const descriptor = descriptors[key];
      if (
        descriptor.get !== undefined ||
        descriptor.set !== undefined ||
        descriptor.enumerable !== true ||
        descriptor.value === undefined
      ) {
        fail(`canonical JSON property ${key} must be enumerable data`);
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value)}`;
    })
    .join(',')}}`;
}

function domainHash(domain, value) {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function parseDestination(value, label) {
  const record = exactRecord(value, label, ['destinationId', 'destinationSha256', 'epochId']);
  return {
    destinationId: nonEmptyString(record.destinationId, `${label}.destinationId`),
    destinationSha256: sha256(record.destinationSha256, `${label}.destinationSha256`),
    epochId: nonEmptyString(record.epochId, `${label}.epochId`),
  };
}

function parseAbortedProvisionAttempt(value, label) {
  if (value === null) {
    return null;
  }
  const record = exactRecord(value, label, ['intentSha256', 'reservationSha256']);
  return {
    intentSha256: sha256(record.intentSha256, `${label}.intentSha256`),
    reservationSha256: sha256(record.reservationSha256, `${label}.reservationSha256`),
  };
}

export function productionDeploymentCommittedHeadSha256(value) {
  const head = parseNonGenesisHeadMaterial(value, 'committed head hash material');
  return domainHash('production-deployment-committed-head-v1', head);
}

function parseNonGenesisHeadMaterial(value, label) {
  const record = exactRecord(value, label, [
    'committedAt',
    'fencingToken',
    'intentSha256',
    'operation',
    'previousCommittedHeadSha256',
    'reservationSha256',
    'resultSha256',
    'sequence',
    'stateSha256',
    'terminal',
  ]);
  return {
    operation: operation(record.operation, `${label}.operation`),
    sequence: sequence(record.sequence, `${label}.sequence`),
    previousCommittedHeadSha256: sha256(
      record.previousCommittedHeadSha256,
      `${label}.previousCommittedHeadSha256`,
    ),
    intentSha256: sha256(record.intentSha256, `${label}.intentSha256`),
    reservationSha256: sha256(record.reservationSha256, `${label}.reservationSha256`),
    resultSha256: sha256(record.resultSha256, `${label}.resultSha256`),
    stateSha256: sha256(record.stateSha256, `${label}.stateSha256`),
    fencingToken: fencingToken(record.fencingToken, `${label}.fencingToken`),
    terminal: boolean(record.terminal, `${label}.terminal`),
    committedAt: timestamp(record.committedAt, `${label}.committedAt`),
  };
}

function parseCommittedHead(value, chainGenesisSha256, initialStateSha256, label) {
  const record = exactRecord(value, label, [
    'committedAt',
    'committedHeadSha256',
    'fencingToken',
    'intentSha256',
    'operation',
    'previousCommittedHeadSha256',
    'reservationSha256',
    'resultSha256',
    'sequence',
    'stateSha256',
    'terminal',
  ]);
  const parsedSequence = sequence(record.sequence, `${label}.sequence`, {
    zeroAllowed: true,
  });
  if (parsedSequence === 0) {
    if (
      record.operation !== null ||
      record.previousCommittedHeadSha256 !== ZERO_SHA256 ||
      record.committedHeadSha256 !== chainGenesisSha256 ||
      record.intentSha256 !== ZERO_SHA256 ||
      record.reservationSha256 !== ZERO_SHA256 ||
      record.resultSha256 !== ZERO_SHA256 ||
      record.stateSha256 !== initialStateSha256 ||
      record.fencingToken !== '0' ||
      record.terminal !== false ||
      record.committedAt !== null
    ) {
      fail(`${label} is not the canonical genesis head`);
    }
    return {
      operation: null,
      sequence: 0,
      previousCommittedHeadSha256: ZERO_SHA256,
      committedHeadSha256: chainGenesisSha256,
      intentSha256: ZERO_SHA256,
      reservationSha256: ZERO_SHA256,
      resultSha256: ZERO_SHA256,
      stateSha256: initialStateSha256,
      fencingToken: '0',
      terminal: false,
      committedAt: null,
    };
  }

  const material = parseNonGenesisHeadMaterial(
    {
      operation: record.operation,
      sequence: parsedSequence,
      previousCommittedHeadSha256: record.previousCommittedHeadSha256,
      intentSha256: record.intentSha256,
      reservationSha256: record.reservationSha256,
      resultSha256: record.resultSha256,
      stateSha256: record.stateSha256,
      fencingToken: record.fencingToken,
      terminal: record.terminal,
      committedAt: record.committedAt,
    },
    label,
  );
  assertOperationSequence(material.sequence, material.operation, `${label}.operation`);
  if (material.sequence === 1 && material.previousCommittedHeadSha256 !== chainGenesisSha256) {
    fail(`${label}.previousCommittedHeadSha256 must be the chain genesis at sequence one`);
  }
  if (BigInt(material.fencingToken) < BigInt(material.sequence)) {
    fail(`${label}.fencingToken must not be lower than its committed sequence`);
  }
  if (
    (material.operation === 'ABORT_PROVISION' && material.terminal !== true) ||
    (material.terminal &&
      material.operation !== 'ABORT_PROVISION' &&
      material.operation !== 'DELETE')
  ) {
    fail(`${label}.terminal is inconsistent with its operation`);
  }
  const committedHeadSha256 = sha256(record.committedHeadSha256, `${label}.committedHeadSha256`);
  if (productionDeploymentCommittedHeadSha256(material) !== committedHeadSha256) {
    fail(`${label}.committedHeadSha256 does not match its content`);
  }
  return { ...material, committedHeadSha256 };
}

function parseReservationContent(value, label) {
  const record = exactRecord(value, label, [
    'abortedProvisionAttempt',
    'chainGenesisSha256',
    'currentStateSha256',
    'destination',
    'expectedCommittedHeadSha256',
    'fencingToken',
    'intentSha256',
    'operation',
    'preemptedReservationSha256',
    'proposedStateSha256',
    'reservedAt',
    'sequence',
  ]);
  return {
    chainGenesisSha256: sha256(record.chainGenesisSha256, `${label}.chainGenesisSha256`),
    destination: parseDestination(record.destination, `${label}.destination`),
    operation: operation(record.operation, `${label}.operation`),
    sequence: sequence(record.sequence, `${label}.sequence`),
    intentSha256: sha256(record.intentSha256, `${label}.intentSha256`),
    expectedCommittedHeadSha256: sha256(
      record.expectedCommittedHeadSha256,
      `${label}.expectedCommittedHeadSha256`,
    ),
    currentStateSha256: sha256(record.currentStateSha256, `${label}.currentStateSha256`),
    proposedStateSha256: sha256(record.proposedStateSha256, `${label}.proposedStateSha256`),
    fencingToken: fencingToken(record.fencingToken, `${label}.fencingToken`),
    reservedAt: timestamp(record.reservedAt, `${label}.reservedAt`),
    preemptedReservationSha256: sha256(
      record.preemptedReservationSha256,
      `${label}.preemptedReservationSha256`,
      { zeroAllowed: true },
    ),
    abortedProvisionAttempt: parseAbortedProvisionAttempt(
      record.abortedProvisionAttempt,
      `${label}.abortedProvisionAttempt`,
    ),
  };
}

export function productionDeploymentReservationSha256(value) {
  return domainHash(
    'production-deployment-chain-reservation-v1',
    parseReservationContent(value, 'reservation hash content'),
  );
}

function parseReservation(value, label) {
  const record = exactRecord(value, label, [
    'artifactType',
    'content',
    'reservationSha256',
    'schemaVersion',
  ]);
  if (record.schemaVersion !== SCHEMA_VERSION || record.artifactType !== RESERVATION_ARTIFACT) {
    fail(`${label} has an unsupported schema or artifact type`);
  }
  const content = parseReservationContent(record.content, `${label}.content`);
  const reservationSha256 = sha256(record.reservationSha256, `${label}.reservationSha256`);
  if (productionDeploymentReservationSha256(content) !== reservationSha256) {
    fail(`${label}.reservationSha256 does not match its content`);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: RESERVATION_ARTIFACT,
    reservationSha256,
    content,
  };
}

function assertReservationSemantics(reservation, label) {
  const { content } = reservation;
  assertOperationSequence(content.sequence, content.operation, `${label}.content.operation`);
  if (content.operation === 'ABORT_PROVISION') {
    if (
      content.abortedProvisionAttempt === null ||
      content.preemptedReservationSha256 === ZERO_SHA256 ||
      content.preemptedReservationSha256 !== content.abortedProvisionAttempt.reservationSha256
    ) {
      fail(`${label} is not an exact provision-abort takeover`);
    }
  } else if (content.abortedProvisionAttempt !== null) {
    fail(`${label} binds an aborted provision attempt for a non-abort operation`);
  }
  if (
    content.preemptedReservationSha256 !== ZERO_SHA256 &&
    content.operation !== 'ABORT_PROVISION' &&
    content.operation !== 'EMERGENCY_KILL'
  ) {
    fail(`${label} uses preemption for a non-preemptive operation`);
  }
}

function parseState(value) {
  const record = exactRecord(value, 'chain state', [
    'activeReservation',
    'artifactType',
    'chainGenesisSha256',
    'committedHead',
    'destination',
    'initialStateSha256',
    'lastFencingToken',
    'schemaVersion',
  ]);
  if (record.schemaVersion !== SCHEMA_VERSION || record.artifactType !== STATE_ARTIFACT) {
    fail('chain state has an unsupported schema or artifact type');
  }
  const chainGenesisSha256 = sha256(record.chainGenesisSha256, 'chain state.chainGenesisSha256');
  const destination = parseDestination(record.destination, 'chain state.destination');
  const initialStateSha256 = sha256(record.initialStateSha256, 'chain state.initialStateSha256');
  const lastFencingToken = fencingToken(record.lastFencingToken, 'chain state.lastFencingToken', {
    zeroAllowed: true,
  });
  const committedHead = parseCommittedHead(
    record.committedHead,
    chainGenesisSha256,
    initialStateSha256,
    'chain state.committedHead',
  );
  const activeReservation =
    record.activeReservation === null
      ? null
      : parseReservation(record.activeReservation, 'chain state.activeReservation');
  if (activeReservation !== null) {
    assertReservationSemantics(activeReservation, 'chain state.activeReservation');
  }
  const expectedLatestFencingToken =
    activeReservation?.content.fencingToken ?? committedHead.fencingToken;
  if (lastFencingToken !== expectedLatestFencingToken) {
    fail('chain state last fencing token does not match its latest artifact');
  }
  if (activeReservation !== null) {
    const content = activeReservation.content;
    if (
      content.chainGenesisSha256 !== chainGenesisSha256 ||
      !sameValue(content.destination, destination) ||
      content.expectedCommittedHeadSha256 !== committedHead.committedHeadSha256 ||
      content.sequence !== committedHead.sequence + 1 ||
      content.currentStateSha256 !== committedHead.stateSha256 ||
      BigInt(content.fencingToken) <= BigInt(committedHead.fencingToken) ||
      (committedHead.committedAt !== null &&
        Date.parse(content.reservedAt) < Date.parse(committedHead.committedAt))
    ) {
      fail('chain state active reservation is not continuous with the committed head');
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: STATE_ARTIFACT,
    chainGenesisSha256,
    destination,
    initialStateSha256,
    lastFencingToken,
    committedHead,
    activeReservation,
  };
}

function parsePredecessor(value, label) {
  const record = exactRecord(value, label, [
    'committedHeadSha256',
    'intentSha256',
    'reservationSha256',
    'resultSha256',
    'sequence',
    'stateSha256',
  ]);
  return {
    sequence: sequence(record.sequence, `${label}.sequence`, { zeroAllowed: true }),
    committedHeadSha256: sha256(record.committedHeadSha256, `${label}.committedHeadSha256`),
    intentSha256: sha256(record.intentSha256, `${label}.intentSha256`, {
      zeroAllowed: true,
    }),
    reservationSha256: sha256(record.reservationSha256, `${label}.reservationSha256`, {
      zeroAllowed: true,
    }),
    resultSha256: sha256(record.resultSha256, `${label}.resultSha256`, {
      zeroAllowed: true,
    }),
    stateSha256: sha256(record.stateSha256, `${label}.stateSha256`),
  };
}

function parseIntentProjection(value) {
  const record = exactRecord(value, 'command.intent', [
    'abortedProvisionAttempt',
    'chainGenesisSha256',
    'currentStateSha256',
    'destination',
    'intentSha256',
    'operation',
    'predecessor',
    'proposedStateSha256',
    'sequence',
  ]);
  return {
    chainGenesisSha256: sha256(record.chainGenesisSha256, 'command.intent.chainGenesisSha256'),
    destination: parseDestination(record.destination, 'command.intent.destination'),
    operation: operation(record.operation, 'command.intent.operation'),
    sequence: sequence(record.sequence, 'command.intent.sequence'),
    intentSha256: sha256(record.intentSha256, 'command.intent.intentSha256'),
    predecessor: parsePredecessor(record.predecessor, 'command.intent.predecessor'),
    currentStateSha256: sha256(record.currentStateSha256, 'command.intent.currentStateSha256'),
    proposedStateSha256: sha256(record.proposedStateSha256, 'command.intent.proposedStateSha256'),
    abortedProvisionAttempt: parseAbortedProvisionAttempt(
      record.abortedProvisionAttempt,
      'command.intent.abortedProvisionAttempt',
    ),
  };
}

function assertIntentContinuity(state, intent) {
  const head = state.committedHead;
  assertOperationSequence(intent.sequence, intent.operation, 'command.intent.operation');
  if (
    intent.chainGenesisSha256 !== state.chainGenesisSha256 ||
    !sameValue(intent.destination, state.destination)
  ) {
    fail('intent projection targets a different destination epoch');
  }
  if (
    intent.sequence !== head.sequence + 1 ||
    intent.currentStateSha256 !== head.stateSha256 ||
    !sameValue(intent.predecessor, {
      sequence: head.sequence,
      committedHeadSha256: head.committedHeadSha256,
      intentSha256: head.intentSha256,
      reservationSha256: head.reservationSha256,
      resultSha256: head.resultSha256,
      stateSha256: head.stateSha256,
    })
  ) {
    fail('intent projection is stale or does not match the committed head');
  }
  if (head.terminal) {
    fail('terminal deployment chains cannot reserve another intent');
  }
  if (intent.operation === 'ABORT_PROVISION') {
    if (intent.abortedProvisionAttempt === null) {
      fail('abort intent must bind the provision attempt it aborts');
    }
  } else if (intent.abortedProvisionAttempt !== null) {
    fail('only abort intent may bind an aborted provision attempt');
  }
}

function nextFencingToken(state) {
  const next = BigInt(state.lastFencingToken) + 1n;
  if (next > MAX_FENCING_TOKEN) {
    fail('deployment chain fencing token is exhausted');
  }
  return String(next);
}

function reservationFor(state, intent, issuedFencingToken, reservedAt) {
  assertIntentContinuity(state, intent);
  const active = state.activeReservation;
  if (active !== null && active.content.intentSha256 === intent.intentSha256) {
    const existing = active.content;
    if (
      existing.operation !== intent.operation ||
      existing.sequence !== intent.sequence ||
      existing.expectedCommittedHeadSha256 !== intent.predecessor.committedHeadSha256 ||
      existing.currentStateSha256 !== intent.currentStateSha256 ||
      existing.proposedStateSha256 !== intent.proposedStateSha256 ||
      !sameValue(existing.abortedProvisionAttempt, intent.abortedProvisionAttempt) ||
      existing.fencingToken !== issuedFencingToken ||
      existing.reservedAt !== reservedAt
    ) {
      fail('intent digest replay does not exactly match the active reservation request');
    }
    return { reservation: active, replayed: true, preempted: false };
  }

  if (active === null && intent.operation === 'ABORT_PROVISION') {
    fail('abort intent requires the exact active provision reservation');
  }

  let preemptedReservationSha256 = ZERO_SHA256;
  if (active !== null) {
    const mayAbortProvision =
      intent.operation === 'ABORT_PROVISION' &&
      active.content.operation === 'PROVISION_INERT' &&
      active.content.sequence === 1 &&
      intent.abortedProvisionAttempt?.intentSha256 === active.content.intentSha256 &&
      intent.abortedProvisionAttempt?.reservationSha256 === active.reservationSha256;
    const mayEmergencyKill =
      intent.operation === 'EMERGENCY_KILL' && active.content.operation !== 'EMERGENCY_KILL';
    if (!mayAbortProvision && !mayEmergencyKill) {
      fail('a different intent already owns this committed head');
    }
    preemptedReservationSha256 = active.reservationSha256;
  }

  if (
    state.committedHead.committedAt !== null &&
    Date.parse(reservedAt) < Date.parse(state.committedHead.committedAt)
  ) {
    fail('reservation predates the committed head');
  }
  if (active !== null && Date.parse(reservedAt) < Date.parse(active.content.reservedAt)) {
    fail('preempting reservation predates the reservation it supersedes');
  }

  const expectedFencingToken = nextFencingToken(state);
  if (issuedFencingToken !== expectedFencingToken) {
    fail('issued fencing token is not the next monotonic token');
  }
  const content = {
    chainGenesisSha256: state.chainGenesisSha256,
    destination: state.destination,
    operation: intent.operation,
    sequence: intent.sequence,
    intentSha256: intent.intentSha256,
    expectedCommittedHeadSha256: intent.predecessor.committedHeadSha256,
    currentStateSha256: intent.currentStateSha256,
    proposedStateSha256: intent.proposedStateSha256,
    fencingToken: issuedFencingToken,
    reservedAt,
    preemptedReservationSha256,
    abortedProvisionAttempt: intent.abortedProvisionAttempt,
  };
  const reservation = {
    schemaVersion: SCHEMA_VERSION,
    artifactType: RESERVATION_ARTIFACT,
    reservationSha256: productionDeploymentReservationSha256(content),
    content,
  };
  return { reservation, replayed: false, preempted: active !== null };
}

function parseResultContent(value, label) {
  const record = exactRecord(value, label, [
    'chainGenesisSha256',
    'destination',
    'fencingToken',
    'intentSha256',
    'liveStateEvidenceSha256',
    'observedAt',
    'operation',
    'outcome',
    'reservationSha256',
    'resultingStateSha256',
    'sequence',
  ]);
  if (typeof record.outcome !== 'string' || !OUTCOME_SET.has(record.outcome)) {
    fail(`${label}.outcome must be APPLIED or NOT_APPLIED`);
  }
  return {
    chainGenesisSha256: sha256(record.chainGenesisSha256, `${label}.chainGenesisSha256`),
    destination: parseDestination(record.destination, `${label}.destination`),
    operation: operation(record.operation, `${label}.operation`),
    sequence: sequence(record.sequence, `${label}.sequence`),
    intentSha256: sha256(record.intentSha256, `${label}.intentSha256`),
    reservationSha256: sha256(record.reservationSha256, `${label}.reservationSha256`),
    fencingToken: fencingToken(record.fencingToken, `${label}.fencingToken`),
    outcome: record.outcome,
    resultingStateSha256: sha256(record.resultingStateSha256, `${label}.resultingStateSha256`),
    liveStateEvidenceSha256: sha256(
      record.liveStateEvidenceSha256,
      `${label}.liveStateEvidenceSha256`,
    ),
    observedAt: timestamp(record.observedAt, `${label}.observedAt`),
  };
}

export function productionDeploymentResultSha256(value) {
  return domainHash(
    'production-deployment-chain-result-v1',
    parseResultContent(value, 'result hash content'),
  );
}

function parseResult(value) {
  const record = exactRecord(value, 'command.result', [
    'artifactType',
    'content',
    'resultSha256',
    'schemaVersion',
  ]);
  if (record.schemaVersion !== SCHEMA_VERSION || record.artifactType !== RESULT_ARTIFACT) {
    fail('command.result has an unsupported schema or artifact type');
  }
  const content = parseResultContent(record.content, 'command.result.content');
  const resultSha256 = sha256(record.resultSha256, 'command.result.resultSha256');
  if (productionDeploymentResultSha256(content) !== resultSha256) {
    fail('command.result.resultSha256 does not match its content');
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: RESULT_ARTIFACT,
    resultSha256,
    content,
  };
}

function receiptContent(value, label) {
  const record = exactRecord(value, label, [
    'chainGenesisSha256',
    'committedAt',
    'committedHeadSha256',
    'destination',
    'fencingToken',
    'intentSha256',
    'operation',
    'previousCommittedHeadSha256',
    'reservationSha256',
    'resultSha256',
    'sequence',
    'stateSha256',
    'terminal',
  ]);
  return {
    chainGenesisSha256: sha256(record.chainGenesisSha256, `${label}.chainGenesisSha256`),
    destination: parseDestination(record.destination, `${label}.destination`),
    operation: operation(record.operation, `${label}.operation`),
    sequence: sequence(record.sequence, `${label}.sequence`),
    previousCommittedHeadSha256: sha256(
      record.previousCommittedHeadSha256,
      `${label}.previousCommittedHeadSha256`,
    ),
    committedHeadSha256: sha256(record.committedHeadSha256, `${label}.committedHeadSha256`),
    intentSha256: sha256(record.intentSha256, `${label}.intentSha256`),
    reservationSha256: sha256(record.reservationSha256, `${label}.reservationSha256`),
    resultSha256: sha256(record.resultSha256, `${label}.resultSha256`),
    stateSha256: sha256(record.stateSha256, `${label}.stateSha256`),
    fencingToken: fencingToken(record.fencingToken, `${label}.fencingToken`),
    terminal: boolean(record.terminal, `${label}.terminal`),
    committedAt: timestamp(record.committedAt, `${label}.committedAt`),
  };
}

export function productionDeploymentCommitReceiptSha256(value) {
  return domainHash(
    'production-deployment-chain-commit-receipt-v1',
    receiptContent(value, 'commit receipt hash content'),
  );
}

function receiptFor(state, head) {
  const content = {
    chainGenesisSha256: state.chainGenesisSha256,
    destination: state.destination,
    operation: head.operation,
    sequence: head.sequence,
    previousCommittedHeadSha256: head.previousCommittedHeadSha256,
    committedHeadSha256: head.committedHeadSha256,
    intentSha256: head.intentSha256,
    reservationSha256: head.reservationSha256,
    resultSha256: head.resultSha256,
    stateSha256: head.stateSha256,
    fencingToken: head.fencingToken,
    terminal: head.terminal,
    committedAt: head.committedAt,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: RECEIPT_ARTIFACT,
    receiptSha256: productionDeploymentCommitReceiptSha256(content),
    content,
  };
}

function commitResult(state, result, committedAt) {
  const active = state.activeReservation;
  if (active === null) {
    const head = state.committedHead;
    if (
      head.sequence === result.content.sequence &&
      head.operation === result.content.operation &&
      head.intentSha256 === result.content.intentSha256 &&
      head.reservationSha256 === result.content.reservationSha256 &&
      head.resultSha256 === result.resultSha256 &&
      head.stateSha256 === result.content.resultingStateSha256 &&
      head.committedAt === committedAt
    ) {
      return {
        state,
        receipt: receiptFor(state, head),
        replayed: true,
      };
    }
    fail('result has no matching active reservation or committed receipt');
  }

  const reservation = active.content;
  const content = result.content;
  if (
    content.chainGenesisSha256 !== state.chainGenesisSha256 ||
    !sameValue(content.destination, state.destination) ||
    content.operation !== reservation.operation ||
    content.sequence !== reservation.sequence ||
    content.intentSha256 !== reservation.intentSha256 ||
    content.reservationSha256 !== active.reservationSha256 ||
    content.fencingToken !== reservation.fencingToken
  ) {
    fail('result is not bound to the active reservation');
  }
  if (Date.parse(content.observedAt) < Date.parse(reservation.reservedAt)) {
    fail('result observation predates its reservation');
  }
  if (Date.parse(committedAt) < Date.parse(content.observedAt)) {
    fail('result commit predates its observation');
  }
  const expectedState =
    content.outcome === 'APPLIED'
      ? reservation.proposedStateSha256
      : reservation.currentStateSha256;
  if (content.resultingStateSha256 !== expectedState) {
    fail('resulting state does not match the reserved transition outcome');
  }
  if (
    content.outcome === 'NOT_APPLIED' &&
    (content.operation === 'PROVISION_INERT' ||
      content.operation === 'ABORT_PROVISION' ||
      content.operation === 'EMERGENCY_KILL')
  ) {
    fail(
      'provision, abort, and emergency-kill attempts require an applied result or remain reserved',
    );
  }

  const terminal =
    content.outcome === 'APPLIED' &&
    (content.operation === 'ABORT_PROVISION' || content.operation === 'DELETE');
  const material = {
    operation: content.operation,
    sequence: content.sequence,
    previousCommittedHeadSha256: state.committedHead.committedHeadSha256,
    intentSha256: content.intentSha256,
    reservationSha256: content.reservationSha256,
    resultSha256: result.resultSha256,
    stateSha256: content.resultingStateSha256,
    fencingToken: content.fencingToken,
    terminal,
    committedAt,
  };
  const head = {
    ...material,
    committedHeadSha256: productionDeploymentCommittedHeadSha256(material),
  };
  const nextState = {
    ...state,
    committedHead: head,
    activeReservation: null,
  };
  return {
    state: nextState,
    receipt: receiptFor(nextState, head),
    replayed: false,
  };
}

function baseReport() {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactType: 'PRODUCTION_DEPLOYMENT_CHAIN_PROTOCOL_REPORT_V1',
    offlineProtocolOnly: true,
    requiresDurableAdapter: true,
    protocolValid: false,
    simulatedTransitionAccepted: false,
    simulatedReservationCreated: false,
    simulatedCommittedHeadAdvanced: false,
    idempotentReplay: false,
    preemptedReservation: false,
    intentAuthorityVerified: false,
    resultAuthorityVerified: false,
    liveStateVerified: false,
    trustedTimeVerified: false,
    durableStateAuthenticityVerified: false,
    durableStoreSelected: false,
    durableCasAccepted: false,
    reservationCommitted: false,
    committedHeadPersisted: false,
    productionBrandIssued: false,
    executionAllowed: false,
    providerReadCalls: 0,
    providerWriteCalls: 0,
    signerCalls: 0,
    cloudApiCalls: 0,
    networkCalls: 0,
    nextState: null,
    reservation: null,
    commitReceipt: null,
    errors: [],
  };
}

export function evaluateProductionDeploymentChainProtocolTransition(stateValue, commandValue) {
  const report = baseReport();
  try {
    const state = parseState(stateValue);
    const commandRecord = dataRecord(commandValue, 'command');
    const kindDescriptor = Object.getOwnPropertyDescriptor(commandRecord, 'kind');
    if (
      kindDescriptor === undefined ||
      kindDescriptor.get !== undefined ||
      kindDescriptor.set !== undefined
    ) {
      fail('command.kind must be a data property');
    }
    if (kindDescriptor.value === 'RESERVE') {
      const command = exactRecord(commandValue, 'command', [
        'intent',
        'issuedFencingToken',
        'kind',
        'reservedAt',
      ]);
      const intent = parseIntentProjection(command.intent);
      const issuedFencingToken = fencingToken(
        command.issuedFencingToken,
        'command.issuedFencingToken',
      );
      const reservedAt = timestamp(command.reservedAt, 'command.reservedAt');
      const reservationOutcome = reservationFor(state, intent, issuedFencingToken, reservedAt);
      const nextState = reservationOutcome.replayed
        ? state
        : {
            ...state,
            lastFencingToken: reservationOutcome.reservation.content.fencingToken,
            activeReservation: reservationOutcome.reservation,
          };
      return deepFreeze({
        ...report,
        protocolValid: true,
        simulatedTransitionAccepted: true,
        simulatedReservationCreated: !reservationOutcome.replayed,
        idempotentReplay: reservationOutcome.replayed,
        preemptedReservation: reservationOutcome.preempted,
        nextState,
        reservation: reservationOutcome.reservation,
      });
    }
    if (kindDescriptor.value === 'COMMIT_RESULT') {
      const command = exactRecord(commandValue, 'command', ['committedAt', 'kind', 'result']);
      const result = parseResult(command.result);
      const committedAt = timestamp(command.committedAt, 'command.committedAt');
      const outcome = commitResult(state, result, committedAt);
      return deepFreeze({
        ...report,
        protocolValid: true,
        simulatedTransitionAccepted: true,
        simulatedCommittedHeadAdvanced: !outcome.replayed,
        idempotentReplay: outcome.replayed,
        nextState: outcome.state,
        commitReceipt: outcome.receipt,
      });
    }
    fail('command.kind must be RESERVE or COMMIT_RESULT');
  } catch (error) {
    report.errors.push(
      error instanceof Error ? error.message : 'deployment chain protocol validation failed',
    );
    return deepFreeze(report);
  }
}

export const PRODUCTION_DEPLOYMENT_CHAIN_PROTOCOL = deepFreeze({
  schemaVersion: SCHEMA_VERSION,
  stateArtifactType: STATE_ARTIFACT,
  reservationArtifactType: RESERVATION_ARTIFACT,
  resultArtifactType: RESULT_ARTIFACT,
  commitReceiptArtifactType: RECEIPT_ARTIFACT,
  operations: [...OPERATIONS],
  zeroSha256: ZERO_SHA256,
  maximumSequence: MAX_SEQUENCE,
  maximumFencingToken: String(MAX_FENCING_TOKEN),
});
