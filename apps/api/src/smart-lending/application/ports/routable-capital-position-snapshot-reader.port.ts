import type { AccountId } from '../../../accounts/domain/account-profile';
import type { MainnetLaunchNetworkId } from '../../../blockchain/domain/mainnet-launch-network-policy';
import type { SupportedStablecoin } from '../../../blockchain/domain/supported-asset-registry';

export const ROUTABLE_CAPITAL_POSITION_SNAPSHOT_READER = Symbol(
  'ROUTABLE_CAPITAL_POSITION_SNAPSHOT_READER',
);

export interface RoutableCapitalPosition {
  readonly positionId: string;
  readonly walletId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly assetId: string;
  readonly assetSymbol: SupportedStablecoin;
  readonly assetDecimals: 6;
  readonly walletAddress: string;
  readonly amountAtomic: bigint;
  readonly amountUsdMantissa: bigint;
}

/** One account-owned, explicitly selected receiving wallet per destination network. */
export interface SmartLendingDestinationWallet {
  readonly walletId: string;
  readonly networkId: MainnetLaunchNetworkId;
  readonly walletAddress: string;
  readonly selectionReferenceId: string;
}

export interface RoutableCapitalPositionSnapshot {
  readonly schemaVersion: 1;
  readonly use: 'SMART_LENDING_ROUTABLE_CAPITAL';
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  readonly snapshotReferenceId: string;
  readonly capturedAt: string;
  readonly validUntil: string;
  readonly coverage: 'COMPLETE';
  readonly valuationPolicyApprovalReferenceId: string;
  readonly positions: readonly RoutableCapitalPosition[];
  readonly destinationWallets: readonly SmartLendingDestinationWallet[];
}

export interface ReadRoutableCapitalPositionSnapshotRequest {
  readonly accountId: AccountId;
  readonly correlationId: string;
  readonly evaluatedAt: string;
  /** Shared aggregate composer deadline for all evidence and quote reads. */
  readonly deadlineAt: string;
  /** Implementations must stop their own I/O promptly when aborted. */
  readonly signal: AbortSignal;
}

export interface RoutableCapitalPositionSnapshotReader {
  readRoutableCapitalPositions(
    request: ReadRoutableCapitalPositionSnapshotRequest,
  ): Promise<RoutableCapitalPositionSnapshot>;
}
