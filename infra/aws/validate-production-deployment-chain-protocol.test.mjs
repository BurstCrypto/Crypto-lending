import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PRODUCTION_DEPLOYMENT_CHAIN_PROTOCOL,
  evaluateProductionDeploymentChainProtocolTransition,
  productionDeploymentCommittedHeadSha256,
  productionDeploymentCommitReceiptSha256,
  productionDeploymentReservationSha256,
  productionDeploymentResultSha256,
} from './validate-production-deployment-chain-protocol.mjs';

const hash = (character) => character.repeat(64);
const CHAIN_GENESIS_SHA256 = hash('1');
const DESTINATION_SHA256 = hash('2');
const INITIAL_STATE_SHA256 = hash('3');
const PROVISION_STATE_SHA256 = hash('4');
const ACTIVE_STATE_SHA256 = hash('5');
const LIVE_EVIDENCE_SHA256 = hash('6');
const ZERO_SHA256 = PRODUCTION_DEPLOYMENT_CHAIN_PROTOCOL.zeroSha256;
const DESTINATION = Object.freeze({
  destinationId: 'production-us-west-2',
  destinationSha256: DESTINATION_SHA256,
  epochId: 'epoch-2026-09-07',
});

function genesisState() {
  return {
    schemaVersion: 1,
    artifactType: PRODUCTION_DEPLOYMENT_CHAIN_PROTOCOL.stateArtifactType,
    chainGenesisSha256: CHAIN_GENESIS_SHA256,
    destination: DESTINATION,
    initialStateSha256: INITIAL_STATE_SHA256,
    lastFencingToken: '0',
    committedHead: {
      operation: null,
      sequence: 0,
      previousCommittedHeadSha256: ZERO_SHA256,
      committedHeadSha256: CHAIN_GENESIS_SHA256,
      intentSha256: ZERO_SHA256,
      reservationSha256: ZERO_SHA256,
      resultSha256: ZERO_SHA256,
      stateSha256: INITIAL_STATE_SHA256,
      fencingToken: '0',
      terminal: false,
      committedAt: null,
    },
    activeReservation: null,
  };
}

function predecessorFrom(state) {
  const head = state.committedHead;
  return {
    sequence: head.sequence,
    committedHeadSha256: head.committedHeadSha256,
    intentSha256: head.intentSha256,
    reservationSha256: head.reservationSha256,
    resultSha256: head.resultSha256,
    stateSha256: head.stateSha256,
  };
}

function rehashCommittedHead(state) {
  const { committedHeadSha256: ignoredCommittedHeadSha256, ...material } = state.committedHead;
  void ignoredCommittedHeadSha256;
  state.committedHead.committedHeadSha256 = productionDeploymentCommittedHeadSha256(material);
}

function intentFor(
  state,
  {
    operation = 'PROVISION_INERT',
    intentSha256 = hash('7'),
    proposedStateSha256 = PROVISION_STATE_SHA256,
    abortedProvisionAttempt = null,
  } = {},
) {
  return {
    chainGenesisSha256: CHAIN_GENESIS_SHA256,
    destination: DESTINATION,
    operation,
    sequence: state.committedHead.sequence + 1,
    intentSha256,
    predecessor: predecessorFrom(state),
    currentStateSha256: state.committedHead.stateSha256,
    proposedStateSha256,
    abortedProvisionAttempt,
  };
}

function reserveCommand(intent, fencingToken = '1', reservedAt = '2026-09-07T12:00:00.000Z') {
  return {
    kind: 'RESERVE',
    intent,
    issuedFencingToken: fencingToken,
    reservedAt,
  };
}

function resultFor(
  reservation,
  {
    outcome = 'APPLIED',
    resultingStateSha256 = reservation.content.proposedStateSha256,
    observedAt = '2026-09-07T12:01:00.000Z',
  } = {},
) {
  const content = {
    chainGenesisSha256: reservation.content.chainGenesisSha256,
    destination: reservation.content.destination,
    operation: reservation.content.operation,
    sequence: reservation.content.sequence,
    intentSha256: reservation.content.intentSha256,
    reservationSha256: reservation.reservationSha256,
    fencingToken: reservation.content.fencingToken,
    outcome,
    resultingStateSha256,
    liveStateEvidenceSha256: LIVE_EVIDENCE_SHA256,
    observedAt,
  };
  return {
    schemaVersion: 1,
    artifactType: PRODUCTION_DEPLOYMENT_CHAIN_PROTOCOL.resultArtifactType,
    resultSha256: productionDeploymentResultSha256(content),
    content,
  };
}

function assertOfflineOnly(report) {
  assert.equal(report.offlineProtocolOnly, true);
  assert.equal(report.requiresDurableAdapter, true);
  assert.equal(report.intentAuthorityVerified, false);
  assert.equal(report.resultAuthorityVerified, false);
  assert.equal(report.liveStateVerified, false);
  assert.equal(report.trustedTimeVerified, false);
  assert.equal(report.durableStateAuthenticityVerified, false);
  assert.equal(report.durableStoreSelected, false);
  assert.equal(report.durableCasAccepted, false);
  assert.equal(report.reservationCommitted, false);
  assert.equal(report.committedHeadPersisted, false);
  assert.equal(report.productionBrandIssued, false);
  assert.equal(report.executionAllowed, false);
  assert.equal(report.providerReadCalls, 0);
  assert.equal(report.providerWriteCalls, 0);
  assert.equal(report.signerCalls, 0);
  assert.equal(report.cloudApiCalls, 0);
  assert.equal(report.networkCalls, 0);
}

test('simulates one-winner head reservation without issuing a durable or execution brand', () => {
  const initial = genesisState();
  const provisionIntent = intentFor(initial);
  const command = reserveCommand(provisionIntent);
  const first = evaluateProductionDeploymentChainProtocolTransition(initial, command);

  assert.equal(first.protocolValid, true);
  assert.equal(first.simulatedTransitionAccepted, true);
  assert.equal(first.simulatedReservationCreated, true);
  assert.equal(first.nextState.lastFencingToken, '1');
  assert.equal(
    first.nextState.activeReservation.reservationSha256,
    first.reservation.reservationSha256,
  );
  assert.equal(
    productionDeploymentReservationSha256(first.reservation.content),
    first.reservation.reservationSha256,
  );
  assertOfflineOnly(first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.nextState.activeReservation.content.destination));

  const replay = evaluateProductionDeploymentChainProtocolTransition(first.nextState, command);
  assert.equal(replay.protocolValid, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.simulatedReservationCreated, false);
  assert.equal(replay.reservation.reservationSha256, first.reservation.reservationSha256);
  assertOfflineOnly(replay);

  const conflicting = evaluateProductionDeploymentChainProtocolTransition(
    first.nextState,
    reserveCommand(
      intentFor(initial, {
        intentSha256: hash('8'),
        proposedStateSha256: hash('9'),
      }),
      '2',
      '2026-09-07T12:00:01.000Z',
    ),
  );
  assert.equal(conflicting.protocolValid, false);
  assert.match(conflicting.errors[0], /already owns/u);
  assert.equal(conflicting.nextState, null);
  assertOfflineOnly(conflicting);

  const alteredReplay = evaluateProductionDeploymentChainProtocolTransition(
    first.nextState,
    reserveCommand({ ...provisionIntent, proposedStateSha256: hash('a') }),
  );
  assert.equal(alteredReplay.protocolValid, false);
  assert.match(alteredReplay.errors[0], /does not exactly match/u);
});

test('binds an applied result, advances a deterministic head, and replays the same receipt', () => {
  const reserved = evaluateProductionDeploymentChainProtocolTransition(
    genesisState(),
    reserveCommand(intentFor(genesisState())),
  );
  const result = resultFor(reserved.reservation);
  const command = {
    kind: 'COMMIT_RESULT',
    result,
    committedAt: '2026-09-07T12:02:00.000Z',
  };
  const committed = evaluateProductionDeploymentChainProtocolTransition(
    reserved.nextState,
    command,
  );

  assert.equal(committed.protocolValid, true);
  assert.equal(committed.simulatedCommittedHeadAdvanced, true);
  assert.equal(committed.nextState.activeReservation, null);
  assert.equal(committed.nextState.committedHead.sequence, 1);
  assert.equal(committed.nextState.committedHead.stateSha256, PROVISION_STATE_SHA256);
  assert.equal(committed.nextState.committedHead.resultSha256, result.resultSha256);
  assert.equal(committed.nextState.committedHead.terminal, false);
  assert.equal(
    productionDeploymentCommitReceiptSha256(committed.commitReceipt.content),
    committed.commitReceipt.receiptSha256,
  );
  assertOfflineOnly(committed);

  const replay = evaluateProductionDeploymentChainProtocolTransition(committed.nextState, command);
  assert.equal(replay.protocolValid, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.simulatedCommittedHeadAdvanced, false);
  assert.equal(replay.commitReceipt.receiptSha256, committed.commitReceipt.receiptSha256);
  assertOfflineOnly(replay);

  const forgedGenesisLink = structuredClone(committed.nextState);
  forgedGenesisLink.committedHead.previousCommittedHeadSha256 = hash('d');
  rehashCommittedHead(forgedGenesisLink);
  const rejectedGenesisLink = evaluateProductionDeploymentChainProtocolTransition(
    forgedGenesisLink,
    command,
  );
  assert.equal(rejectedGenesisLink.protocolValid, false);
  assert.match(rejectedGenesisLink.errors[0], /chain genesis at sequence one/u);

  const rewoundFence = structuredClone(committed.nextState);
  rewoundFence.lastFencingToken = '0';
  const rejectedFenceState = evaluateProductionDeploymentChainProtocolTransition(
    rewoundFence,
    command,
  );
  assert.equal(rejectedFenceState.protocolValid, false);
  assert.match(rejectedFenceState.errors[0], /last fencing token/u);

  const staleIntent = intentFor(genesisState(), { intentSha256: hash('b') });
  const stale = evaluateProductionDeploymentChainProtocolTransition(
    committed.nextState,
    reserveCommand(staleIntent, '2', '2026-09-07T12:03:00.000Z'),
  );
  assert.equal(stale.protocolValid, false);
  assert.match(stale.errors[0], /stale|committed head/u);

  const nextIntent = intentFor(committed.nextState, {
    operation: 'ACTIVATE_READ_ONLY',
    intentSha256: hash('c'),
    proposedStateSha256: ACTIVE_STATE_SHA256,
  });
  const next = evaluateProductionDeploymentChainProtocolTransition(
    committed.nextState,
    reserveCommand(nextIntent, '2', '2026-09-07T12:03:00.000Z'),
  );
  assert.equal(next.protocolValid, true);
  assert.equal(
    next.reservation.content.expectedCommittedHeadSha256,
    committed.nextState.committedHead.committedHeadSha256,
  );

  const secondResult = resultFor(next.reservation, {
    observedAt: '2026-09-07T12:04:00.000Z',
  });
  const secondCommand = {
    kind: 'COMMIT_RESULT',
    result: secondResult,
    committedAt: '2026-09-07T12:05:00.000Z',
  };
  const secondCommitted = evaluateProductionDeploymentChainProtocolTransition(
    next.nextState,
    secondCommand,
  );
  assert.equal(secondCommitted.protocolValid, true);
  assert.equal(secondCommitted.nextState.committedHead.sequence, 2);
  assert.equal(secondCommitted.nextState.committedHead.fencingToken, '2');

  const impossibleRewoundFence = structuredClone(secondCommitted.nextState);
  impossibleRewoundFence.committedHead.fencingToken = '1';
  impossibleRewoundFence.lastFencingToken = '1';
  rehashCommittedHead(impossibleRewoundFence);
  const rejectedRewoundFence = evaluateProductionDeploymentChainProtocolTransition(
    impossibleRewoundFence,
    secondCommand,
  );
  assert.equal(rejectedRewoundFence.protocolValid, false);
  assert.match(rejectedRewoundFence.errors[0], /lower than its committed sequence/u);
});

test('allows only exact abort takeover and fences the superseded provision result', () => {
  const initial = genesisState();
  const provision = evaluateProductionDeploymentChainProtocolTransition(
    initial,
    reserveCommand(intentFor(initial)),
  );
  const abortIntent = intentFor(initial, {
    operation: 'ABORT_PROVISION',
    intentSha256: hash('d'),
    proposedStateSha256: hash('e'),
    abortedProvisionAttempt: {
      intentSha256: provision.reservation.content.intentSha256,
      reservationSha256: provision.reservation.reservationSha256,
    },
  });
  const abort = evaluateProductionDeploymentChainProtocolTransition(
    provision.nextState,
    reserveCommand(abortIntent, '2', '2026-09-07T12:00:01.000Z'),
  );
  assert.equal(abort.protocolValid, true);
  assert.equal(abort.preemptedReservation, true);
  assert.equal(
    abort.reservation.content.preemptedReservationSha256,
    provision.reservation.reservationSha256,
  );
  assert.equal(abort.nextState.lastFencingToken, '2');
  assertOfflineOnly(abort);

  const staleProvisionResult = evaluateProductionDeploymentChainProtocolTransition(
    abort.nextState,
    {
      kind: 'COMMIT_RESULT',
      result: resultFor(provision.reservation),
      committedAt: '2026-09-07T12:02:00.000Z',
    },
  );
  assert.equal(staleProvisionResult.protocolValid, false);
  assert.match(staleProvisionResult.errors[0], /active reservation/u);

  const wrongAbort = evaluateProductionDeploymentChainProtocolTransition(
    provision.nextState,
    reserveCommand(
      {
        ...abortIntent,
        intentSha256: hash('f'),
        abortedProvisionAttempt: {
          ...abortIntent.abortedProvisionAttempt,
          reservationSha256: hash('a'),
        },
      },
      '2',
      '2026-09-07T12:00:01.000Z',
    ),
  );
  assert.equal(wrongAbort.protocolValid, false);
  assert.match(wrongAbort.errors[0], /already owns/u);

  const committedAbort = evaluateProductionDeploymentChainProtocolTransition(abort.nextState, {
    kind: 'COMMIT_RESULT',
    result: resultFor(abort.reservation),
    committedAt: '2026-09-07T12:02:00.000Z',
  });
  assert.equal(committedAbort.protocolValid, true);
  assert.equal(committedAbort.nextState.committedHead.terminal, true);
  const afterTerminal = evaluateProductionDeploymentChainProtocolTransition(
    committedAbort.nextState,
    reserveCommand(
      intentFor(committedAbort.nextState, {
        operation: 'DELETE',
        intentSha256: hash('b'),
      }),
      '3',
      '2026-09-07T12:03:00.000Z',
    ),
  );
  assert.equal(afterTerminal.protocolValid, false);
  assert.match(afterTerminal.errors[0], /terminal/u);
});

test('permits emergency kill takeover but never turns the simulation into authority', () => {
  const initial = genesisState();
  const provisionReservation = evaluateProductionDeploymentChainProtocolTransition(
    initial,
    reserveCommand(intentFor(initial)),
  );
  const provision = evaluateProductionDeploymentChainProtocolTransition(
    provisionReservation.nextState,
    {
      kind: 'COMMIT_RESULT',
      result: resultFor(provisionReservation.reservation),
      committedAt: '2026-09-07T12:02:00.000Z',
    },
  );
  const activation = evaluateProductionDeploymentChainProtocolTransition(
    provision.nextState,
    reserveCommand(
      intentFor(provision.nextState, {
        operation: 'ACTIVATE_READ_ONLY',
        intentSha256: hash('b'),
        proposedStateSha256: ACTIVE_STATE_SHA256,
      }),
      '2',
      '2026-09-07T12:03:00.000Z',
    ),
  );
  const kill = evaluateProductionDeploymentChainProtocolTransition(
    activation.nextState,
    reserveCommand(
      intentFor(provision.nextState, {
        operation: 'EMERGENCY_KILL',
        intentSha256: hash('c'),
        proposedStateSha256: hash('d'),
      }),
      '3',
      '2026-09-07T12:03:01.000Z',
    ),
  );
  assert.equal(kill.protocolValid, true);
  assert.equal(kill.preemptedReservation, true);
  assert.equal(kill.reservation.content.fencingToken, '3');
  assertOfflineOnly(kill);

  const competingKill = evaluateProductionDeploymentChainProtocolTransition(
    kill.nextState,
    reserveCommand(
      intentFor(provision.nextState, {
        operation: 'EMERGENCY_KILL',
        intentSha256: hash('e'),
        proposedStateSha256: hash('f'),
      }),
      '4',
      '2026-09-07T12:03:02.000Z',
    ),
  );
  assert.equal(competingKill.protocolValid, false);
  assert.match(competingKill.errors[0], /already owns/u);

  const notAppliedKill = evaluateProductionDeploymentChainProtocolTransition(kill.nextState, {
    kind: 'COMMIT_RESULT',
    result: resultFor(kill.reservation, {
      outcome: 'NOT_APPLIED',
      resultingStateSha256: provision.nextState.committedHead.stateSha256,
      observedAt: '2026-09-07T12:04:00.000Z',
    }),
    committedAt: '2026-09-07T12:05:00.000Z',
  });
  assert.equal(notAppliedKill.protocolValid, false);
  assert.match(notAppliedKill.errors[0], /remain reserved/u);
  assertOfflineOnly(notAppliedKill);
});

test('fails closed on malformed epochs, zero bindings, state tampering, and ambiguous results', () => {
  const initial = genesisState();
  const unreservedAbort = evaluateProductionDeploymentChainProtocolTransition(
    initial,
    reserveCommand(
      intentFor(initial, {
        operation: 'ABORT_PROVISION',
        intentSha256: hash('8'),
        abortedProvisionAttempt: {
          intentSha256: hash('9'),
          reservationSha256: hash('a'),
        },
      }),
    ),
  );
  assert.equal(unreservedAbort.protocolValid, false);
  assert.match(unreservedAbort.errors[0], /active provision reservation/u);

  const illegalGenesisKill = evaluateProductionDeploymentChainProtocolTransition(
    initial,
    reserveCommand(
      intentFor(initial, {
        operation: 'EMERGENCY_KILL',
        intentSha256: hash('b'),
      }),
    ),
  );
  assert.equal(illegalGenesisKill.protocolValid, false);
  assert.match(illegalGenesisKill.errors[0], /not valid at deployment sequence/u);

  const wrongDestination = evaluateProductionDeploymentChainProtocolTransition(
    initial,
    reserveCommand({
      ...intentFor(initial),
      destination: { ...DESTINATION, epochId: 'different-epoch' },
    }),
  );
  assert.equal(wrongDestination.protocolValid, false);
  assert.match(wrongDestination.errors[0], /different destination epoch/u);

  const zeroIntent = evaluateProductionDeploymentChainProtocolTransition(
    initial,
    reserveCommand({ ...intentFor(initial), intentSha256: ZERO_SHA256 }),
  );
  assert.equal(zeroIntent.protocolValid, false);
  assert.match(zeroIntent.errors[0], /must not be the zero/u);

  const reserved = evaluateProductionDeploymentChainProtocolTransition(
    initial,
    reserveCommand(intentFor(initial)),
  );
  const tamperedState = structuredClone(reserved.nextState);
  tamperedState.activeReservation.reservationSha256 = hash('a');
  const tampered = evaluateProductionDeploymentChainProtocolTransition(
    tamperedState,
    reserveCommand(intentFor(initial), '2', '2026-09-07T12:00:01.000Z'),
  );
  assert.equal(tampered.protocolValid, false);
  assert.match(tampered.errors[0], /does not match its content/u);

  const notAppliedProvision = resultFor(reserved.reservation, {
    outcome: 'NOT_APPLIED',
    resultingStateSha256: INITIAL_STATE_SHA256,
  });
  const rejectedResult = evaluateProductionDeploymentChainProtocolTransition(reserved.nextState, {
    kind: 'COMMIT_RESULT',
    result: notAppliedProvision,
    committedAt: '2026-09-07T12:02:00.000Z',
  });
  assert.equal(rejectedResult.protocolValid, false);
  assert.match(rejectedResult.errors[0], /remain reserved/u);
  assertOfflineOnly(rejectedResult);

  const earlyResult = resultFor(reserved.reservation, {
    observedAt: '2026-09-07T11:59:59.999Z',
  });
  const rejectedTime = evaluateProductionDeploymentChainProtocolTransition(reserved.nextState, {
    kind: 'COMMIT_RESULT',
    result: earlyResult,
    committedAt: '2026-09-07T12:02:00.000Z',
  });
  assert.equal(rejectedTime.protocolValid, false);
  assert.match(rejectedTime.errors[0], /predates its reservation/u);
});
