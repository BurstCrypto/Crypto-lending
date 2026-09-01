'use client';

import type {
  PublicTestnetWithdrawalLaneAvailability,
  PublicTestnetWithdrawalLaneId,
  PublicTestnetWithdrawalLaneState,
} from './public-testnet-withdrawal-coordinator';

interface PublicTestnetWithdrawalLaneProps {
  readonly availability: PublicTestnetWithdrawalLaneAvailability;
  readonly chain: PublicTestnetWithdrawalLaneId;
  readonly position: string;
  readonly recoveryDisabled: boolean;
  readonly state: PublicTestnetWithdrawalLaneState;
  readonly title: string;
  readonly onRecover: () => void;
}

function stateLabel(state: PublicTestnetWithdrawalLaneState): string {
  switch (state.status) {
    case 'IDLE':
      return 'Not started';
    case 'CLAIMED':
      return 'Claimed';
    case 'ACTIVE':
      return 'In progress';
    case 'COMPLETE':
      return 'Complete';
    case 'RECOVERY_REQUIRED':
      return 'Recovery required';
    case 'FAILED':
      return 'Needs attention';
  }
}

export function PublicTestnetWithdrawalLane({
  availability,
  chain,
  onRecover,
  position,
  recoveryDisabled,
  state,
  title,
}: PublicTestnetWithdrawalLaneProps) {
  const promptDisclosure =
    chain === 'EVM'
      ? title === 'Base Sepolia'
        ? 'If needed, the first prompt grants the fixed Base Sepolia gateway a maximum/unlimited aWETH allowance; the second withdraws the full current testnet position.'
        : 'The EVM wallet may show a token approval followed by a full-position withdrawal prompt.'
      : 'Phantom shows one Solana withdrawal transaction.';
  const availabilityCopy =
    availability.status === 'READY'
      ? availability.message
      : availability.status === 'EMPTY'
        ? 'No nonzero position is available on this network.'
        : availability.status === 'ABSENT'
          ? 'No connected position account is available on this network.'
          : availability.status === 'LOADING'
            ? 'Waiting for a validated position snapshot.'
            : availability.message;

  return (
    <article
      className={`public-testnet-withdrawal-lane is-${state.status.toLowerCase()}`}
      aria-label={`${title} withdrawal`}
    >
      <div className="public-testnet-withdrawal-lane-heading">
        <div>
          <strong>{title}</strong>
          <span>{position}</span>
        </div>
        <span>{stateLabel(state)}</span>
      </div>
      <p>{availabilityCopy}</p>
      <small>{promptDisclosure}</small>
      {availability.status === 'LOCKED' && availability.recoverable === true ? (
        <button
          className="portfolio-secondary-action public-testnet-withdrawal-recovery-action"
          type="button"
          disabled={recoveryDisabled}
          onClick={onRecover}
        >
          Check {title} recovery
        </button>
      ) : null}
      {state.message === null ? null : (
        <p className="public-testnet-withdrawal-lane-result" role="status" aria-live="polite">
          {state.message}
        </p>
      )}
    </article>
  );
}
