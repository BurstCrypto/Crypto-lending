import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Wallet } from '@wallet-standard/base';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDemoAllocationPlanner } from '../components/portfolio/local-demo-allocation-planner';
import type { EvmPublicTestnetProofDependencies } from '../components/portfolio/evm-public-testnet-transaction-proof';
import type { PublicTestnetProofDependencies } from '../components/portfolio/public-testnet-transaction-proof';
import {
  EVM_PUBLIC_TESTNET_CHAIN_ID,
  EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
} from '../lib/evm-public-testnet/constants';
import {
  parseEvmPublicTestnetExecutionIntent,
  parseEvmPublicTestnetPositionSnapshot,
  parseEvmPublicTestnetSubmissionResult,
} from '../lib/evm-public-testnet/execution';
import { rememberEvmPublicTestnetPositionAccount } from '../lib/evm-public-testnet/position-account';
import { LocalDemoApiError, type LocalDemoApiClient } from '../lib/local-demo/local-demo-client';
import type {
  LocalDemoAllocationPreview,
  LocalDemoAllocationPresetId,
  LocalDemoAllocationSelectionInput,
  LocalDemoYieldCatalog,
} from '../lib/local-demo/local-demo-yield';
import { rememberPublicTestnetPositionAccount } from '../lib/public-testnet/public-testnet-position-account';
import type {
  InjectedProviderDescriptor,
  SelectedEip1193Provider,
} from '../lib/wallets/eip1193/discovery';
import type { EvmPublicTestnetWalletPort } from '../lib/wallets/eip1193/public-testnet-executor';
import type { SelectedSolanaWallet } from '../lib/wallets/solana/discovery';
import type { SolanaPublicTestnetWalletPort } from '../lib/wallets/solana/public-testnet-executor';
import { expectProviderPrivateDom } from './local-demo-provider-privacy';
import {
  EVM_PUBLIC_TESTNET_ACCOUNT,
  EVM_PUBLIC_TESTNET_INTENT_ID,
  EVM_PUBLIC_TESTNET_NOW,
  EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
  evmPublicTestnetIntentResponse,
  evmPublicTestnetPositionResponse,
  evmPublicTestnetRequest,
  evmPublicTestnetSubmissionResponse,
} from './evm-public-testnet.fixtures';
import {
  CROSS_CHAIN_ZERO_LIQUID_BALANCED_PREVIEW,
  DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW,
  LOCAL_DEMO_YIELD_CATALOG,
  RETAINED_ROUNDING_RESIDUAL_PREVIEW,
  ZERO_LIQUID_BALANCED_PREVIEW,
  ZERO_LIQUID_MORE_LIQUID_PREVIEW,
  ZERO_LIQUID_MORE_YIELD_PREVIEW,
} from './local-demo-yield.fixtures';
import {
  PUBLIC_TESTNET_ACCOUNT,
  PUBLIC_TESTNET_NOW,
  PUBLIC_TESTNET_SIGNATURE,
  publicTestnetIntent,
  publicTestnetPosition,
  publicTestnetSubmission,
} from './public-testnet.fixtures';

const PORTFOLIO_SNAPSHOT_ID = ZERO_LIQUID_BALANCED_PREVIEW.portfolioSnapshotId;
const ZERO_LIQUID_PREVIEWS: Readonly<
  Record<LocalDemoAllocationPresetId, LocalDemoAllocationPreview>
> = Object.freeze({
  MORE_LIQUID: ZERO_LIQUID_MORE_LIQUID_PREVIEW,
  BALANCED: ZERO_LIQUID_BALANCED_PREVIEW,
  MORE_YIELD: ZERO_LIQUID_MORE_YIELD_PREVIEW,
});

function clientWith(options: {
  readonly catalog?: LocalDemoYieldCatalog;
  readonly readYieldCatalog?: (signal?: AbortSignal) => Promise<LocalDemoYieldCatalog>;
  readonly previewAllocation?: (
    portfolioSnapshotId: string,
    selection: LocalDemoAllocationSelectionInput,
    signal?: AbortSignal,
  ) => Promise<LocalDemoAllocationPreview>;
}) {
  const readYieldCatalog = vi.fn(
    options.readYieldCatalog ?? (async () => options.catalog ?? LOCAL_DEMO_YIELD_CATALOG),
  );
  const previewAllocation = vi.fn(
    options.previewAllocation ??
      (async (_portfolioSnapshotId: string, selection: LocalDemoAllocationSelectionInput) =>
        ZERO_LIQUID_PREVIEWS[selection.presetId]),
  );
  return {
    client: { readYieldCatalog, previewAllocation } as unknown as LocalDemoApiClient,
    previewAllocation,
    readYieldCatalog,
  };
}

function adjustedLiquidityPreview(
  preview: LocalDemoAllocationPreview,
  liquidReserveBasisPoints: number,
): LocalDemoAllocationPreview {
  const capital = BigInt(preview.capitalIncludedInProjectionUsdMinor);
  const managedBasisPoints = 10_000 - liquidReserveBasisPoints;
  const liquidProduct = capital * BigInt(liquidReserveBasisPoints);
  const managedProduct = capital * BigInt(managedBasisPoints);
  let liquidAmount = liquidProduct / 10_000n;
  let managedAmount = managedProduct / 10_000n;
  if (liquidAmount + managedAmount < capital) {
    if (liquidProduct % 10_000n >= managedProduct % 10_000n) liquidAmount += 1n;
    else managedAmount += 1n;
  }
  const percentage =
    liquidReserveBasisPoints % 100 === 0
      ? `${Math.floor(liquidReserveBasisPoints / 100)}%`
      : `${Math.floor(liquidReserveBasisPoints / 100)}.${String(liquidReserveBasisPoints % 100).padStart(2, '0')}%`;

  return Object.freeze({
    ...preview,
    selection: Object.freeze({
      ...preview.selection,
      description: `Keep ${percentage} readily available and allocate the remainder to the managed yield strategy.`,
      liquidReserveBasisPoints,
    }),
    allocations: Object.freeze([
      Object.freeze({
        ...preview.allocations[0]!,
        percentageBasisPoints: liquidReserveBasisPoints,
        amountUsdMinor: String(liquidAmount),
      }),
      Object.freeze({
        ...preview.allocations[1]!,
        percentageBasisPoints: managedBasisPoints,
        amountUsdMinor: String(managedAmount),
      }),
    ]),
    managedYieldComposition: Object.freeze([
      Object.freeze({
        ...preview.managedYieldComposition[0]!,
        percentageBasisPointsOfManagedYield: 10_000,
        amountUsdMinor: String(managedAmount),
      }),
      preview.managedYieldComposition[1]!,
    ]),
  });
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('LocalDemoAllocationPlanner', () => {
  it('restores both remembered lending dashboards above allocation before any proof is opened', async () => {
    rememberPublicTestnetPositionAccount(PUBLIC_TESTNET_ACCOUNT);
    rememberEvmPublicTestnetPositionAccount(EVM_PUBLIC_TESTNET_ACCOUNT);
    const readPosition = vi.fn(async () => publicTestnetPosition());
    const proofDependencies: PublicTestnetProofDependencies = {
      createApi: () => ({
        createIntent: vi.fn(async () => publicTestnetIntent()),
        submitTransaction: vi.fn(async () => publicTestnetSubmission()),
        submitSignedTransaction: vi.fn(async () => publicTestnetSubmission()),
        readPosition,
      }),
      createDiscovery: () => ({
        start: vi.fn(),
        stop: vi.fn(),
        list: () => [],
        subscribe: () => vi.fn(),
        select: () => null,
      }),
      createWallet: () => {
        throw new Error('Wallet creation is not expected for a read-only position restore');
      },
      now: () => PUBLIC_TESTNET_NOW,
    };
    const evmPosition = parseEvmPublicTestnetPositionSnapshot(evmPublicTestnetPositionResponse(), {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: EVM_PUBLIC_TESTNET_ACCOUNT,
    });
    const queryPosition = vi.fn(async () => evmPosition);
    const evmProofDependencies: EvmPublicTestnetProofDependencies = {
      createApi: () => ({
        prepare: vi.fn(),
        submit: vi.fn(),
        query: vi.fn(),
        queryPosition,
      }),
      createDiscovery: () => ({
        start: vi.fn(),
        stop: vi.fn(),
        list: () => [],
        subscribe: () => vi.fn(),
        select: () => null,
      }),
      createWallet: () => {
        throw new Error('Wallet creation is not expected for a read-only position restore');
      },
      now: () => EVM_PUBLIC_TESTNET_NOW,
    };
    const harness = clientWith({});
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
        publicTestnetProofDependencies={proofDependencies}
        evmPublicTestnetProofDependencies={evmProofDependencies}
      />,
    );

    const allocationPanel = (
      await screen.findByRole('heading', { name: 'Preview your managed allocation.' })
    ).closest('section');
    const dashboardOverview = screen.getByRole('region', { name: 'Your lending dashboards' });
    const svmDashboard = within(dashboardOverview).getByRole('region', {
      name: 'Your Devnet lending position',
    });
    const evmDashboard = within(dashboardOverview).getByRole('region', {
      name: 'Your Base Sepolia position',
    });
    expect(await within(svmDashboard).findByText(/0\.010000 SOL/u)).toBeInTheDocument();
    expect(await within(evmDashboard).findByText(/0\.00005000 ETH/u)).toBeInTheDocument();
    const withdrawal = within(dashboardOverview).getByRole('region', {
      name: 'Withdraw your lending positions',
    });
    expect(withdrawal.previousElementSibling).toBe(
      dashboardOverview.querySelector('.public-testnet-dashboard-grid'),
    );
    expect(withdrawal.nextElementSibling).toBeNull();
    expect(dashboardOverview.nextElementSibling).toBe(allocationPanel);
    expect(
      within(withdrawal).getByRole('button', { name: 'Withdraw both testnet positions' }),
    ).toBeEnabled();
    expect(within(withdrawal).queryByText(/Withdrawal support is unavailable/iu)).toBeNull();
    expect(readPosition).toHaveBeenCalledWith(
      expect.objectContaining({ account: PUBLIC_TESTNET_ACCOUNT }),
      expect.any(AbortSignal),
    );
    expect(queryPosition).toHaveBeenCalledWith(
      { chainId: EVM_PUBLIC_TESTNET_CHAIN_ID, account: EVM_PUBLIC_TESTNET_ACCOUNT },
      expect.any(AbortSignal),
    );
    expect(screen.queryByRole('button', { name: 'Review 0.01 SOL Devnet proof' })).toBeNull();
  });

  it('offers one honest managed blend and no fee amount before selection', async () => {
    const harness = clientWith({});
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: 'Crypto Lending managed blend' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^(?:Rates current|Archived rates · stale)$/u)).toBeInTheDocument();
    expect(screen.getByText(/make no live external request/u)).toBeInTheDocument();
    expect(screen.getByText(/Managed snapshot assembled/u)).toBeInTheDocument();
    expect(screen.queryByText(/Rates captured/u)).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Managed allocation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Managed blend/u })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /More liquid/u })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More yield/u })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Preview blend/u })).toHaveLength(1);
    expect(screen.getAllByText(/Starts fully allocated to managed yield/u)).toHaveLength(1);
    expect(screen.getAllByText('Default liquid reserve')).toHaveLength(1);
    expect(screen.getAllByText('0%')).toHaveLength(1);
    expect(screen.getAllByText('100%')).toHaveLength(1);
    expect(screen.queryByText(/Custom yield/u)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('slider', {
        name: 'Share of projected capital kept liquid after deducted costs',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Estimated one-time fees' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\$\d/u)).not.toBeInTheDocument();
    expect(screen.queryByText('First positive day after estimated fees')).not.toBeInTheDocument();
    expectProviderPrivateDom(rendered.container);
    expect(harness.previewAllocation).not.toHaveBeenCalled();
  });

  it('shows aggregate variable fees and the exact first-positive day only after selection', async () => {
    const harness = clientWith({});
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    const managedBlend = await screen.findByRole('button', { name: /Managed blend/u });
    await waitFor(() => expect(managedBlend).toBeEnabled());
    fireEvent.click(managedBlend);

    expect(harness.previewAllocation).toHaveBeenCalledWith(
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 0 },
      expect.any(AbortSignal),
    );
    const feeHeading = await screen.findByRole('heading', { name: 'Estimated one-time fees' });
    const feeSection = feeHeading.closest('section');
    expect(feeSection).not.toBeNull();
    expect(within(feeSection!).getByText('Estimated network costs')).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('6 US dollars and 23 cents')).toHaveTextContent(
      '$6.23',
    );
    const conversionRow = within(feeSection!).getByText('Estimated conversion costs').closest('li');
    expect(conversionRow).not.toBeNull();
    expect(within(conversionRow!).getByLabelText('0 US dollars')).toHaveTextContent('$0.00');
    expect(within(feeSection!).getByText('Estimated market impact')).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('2 US dollars and 52 cents')).toHaveTextContent(
      '$2.52',
    );
    expect(within(feeSection!).getByText('Estimated platform routing fee')).toBeInTheDocument();
    expect(
      within(feeSection!).getByText(/Free tier charges 0\.20% of managed capital/iu),
    ).toBeInTheDocument();
    expect(within(feeSection!).getByLabelText('13 US dollars and 98 cents')).toHaveTextContent(
      '$13.98',
    );
    expect(within(feeSection!).getByLabelText('22 US dollars and 73 cents')).toHaveTextContent(
      '$22.73',
    );
    expect(within(feeSection!).getAllByText(/Deducted from available capital/iu)).toHaveLength(4);
    expect(
      within(feeSection!).getByText(/Added on top of available capital/iu),
    ).toBeInTheDocument();
    expect(within(feeSection!).getByText(/Actual local operation: \$0/u)).toBeInTheDocument();
    expect(
      within(feeSection!).getByText(/direct-compatible route has a \$0 platform routing fee/iu),
    ).toBeInTheDocument();
    expect(
      within(feeSection!).getByText(/Public execution costs:\s*unquoted/iu),
    ).toBeInTheDocument();

    const projection = screen
      .getByRole('heading', { name: 'Illustrative yield result' })
      .closest('section');
    expect(projection).not.toBeNull();
    expect(
      within(projection!).getByLabelText('9.50 percent estimated annual percentage yield'),
    ).toHaveTextContent('9.50%');
    expect(within(projection!).getByLabelText('664 US dollars and 16 cents')).toHaveTextContent(
      '$664.16',
    );
    expect(within(projection!).getByLabelText('641 US dollars and 43 cents')).toHaveTextContent(
      '$641.43',
    );
    expect(
      within(projection!).getByLabelText(
        'First positive whole-cent yield after estimated fees is day 13',
      ),
    ).toHaveTextContent('Day 13');
    expect(ZERO_LIQUID_BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees.day).toBe(
      Math.ceil((2_273 * 365) / 66_416),
    );
    expect(screen.getByText('Liquid reserve', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Managed yield', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/preview ready.*\$22\.73/iu)).toBeInTheDocument();
    expect(screen.getByText(/0\.25 percentage-point bucket/iu)).toBeInTheDocument();
    const reconciliation = (await screen.findByText('Full available capital')).closest('dl');
    expect(reconciliation).not.toBeNull();
    expect(
      within(reconciliation!).getByText('Estimated costs deducted from capital'),
    ).toBeInTheDocument();
    expect(within(reconciliation!).getByLabelText('8 US dollars and 75 cents')).toHaveTextContent(
      '$8.75',
    );
    expect(
      within(reconciliation!).getByLabelText('6,991 US dollars and 25 cents'),
    ).toHaveTextContent('$6,991.25');
    expect(within(reconciliation!).getByText('Platform fee added on top')).toBeInTheDocument();
    expect(within(reconciliation!).getByLabelText('13 US dollars and 98 cents')).toHaveTextContent(
      '$13.98',
    );
    expect(
      within(reconciliation!).getByText('Required capital including added-on-top fee'),
    ).toBeInTheDocument();
    expect(
      within(reconciliation!).getByLabelText('7,013 US dollars and 98 cents'),
    ).toHaveTextContent('$7,013.98');
    expect(screen.queryByText('Retained rounding residual (not a fee)')).not.toBeInTheDocument();
    const slider = screen.getByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '9500');
    expect(slider).toHaveAttribute('step', '500');
    expect(slider).toHaveValue('0');
    expect(slider).toHaveAttribute('aria-valuetext', '0% kept liquid in the draft');
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      'Current applied preview: 0% liquid. Draft: 0% liquid · matches current preview.',
    );
    expect(screen.getByRole('button', { name: 'Update preview' })).toBeDisabled();
    expectProviderPrivateDom(rendered.container);
  });

  it('shows a provider-private native EVM and Solana blend only after selection', async () => {
    const harness = clientWith({
      previewAllocation: async () => CROSS_CHAIN_ZERO_LIQUID_BALANCED_PREVIEW,
    });
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={CROSS_CHAIN_ZERO_LIQUID_BALANCED_PREVIEW.portfolioSnapshotId}
      />,
    );

    expect(
      screen.queryByRole('heading', { name: 'Managed allocation by ecosystem' }),
    ).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));

    const composition = (
      await screen.findByRole('heading', { name: 'Managed allocation by ecosystem' })
    ).closest('section');
    expect(composition).not.toBeNull();
    expect(within(composition!).getByText('EVM managed yield')).toBeInTheDocument();
    expect(within(composition!).getByText('SVM managed yield')).toBeInTheDocument();
    expect(within(composition!).getByText('2 ecosystems')).toBeInTheDocument();
    expect(within(composition!).queryByText(/\b[0-9]+ allocations?\b/iu)).not.toBeInTheDocument();
    expect(within(composition!).getByLabelText('63.61% of managed yield')).toHaveTextContent(
      '63.61%',
    );
    expect(within(composition!).getByLabelText('36.39% of managed yield')).toHaveTextContent(
      '36.39%',
    );
    const evmCard = within(composition!).getByText('EVM managed yield').closest('li');
    const svmCard = within(composition!).getByText('SVM managed yield').closest('li');
    expect(evmCard).not.toBeNull();
    expect(svmCard).not.toBeNull();
    expect(within(evmCard!).getByText('Managed amount')).toBeInTheDocument();
    expect(within(evmCard!).getByText('Source capital')).toBeInTheDocument();
    expect(within(evmCard!).getByLabelText('6,991 US dollars and 25 cents')).toHaveTextContent(
      '$6,991.25',
    );
    expect(within(evmCard!).getByLabelText('7,000 US dollars')).toHaveTextContent('$7,000.00');
    expect(within(svmCard!).getByLabelText('3,998 US dollars and 71 cents')).toHaveTextContent(
      '$3,998.71',
    );
    expect(within(svmCard!).getByLabelText('4,000 US dollars')).toHaveTextContent('$4,000.00');
    expect(
      within(composition!).getByText('No EVM-to-Solana transfer is modeled.'),
    ).toBeInTheDocument();
    expect(within(composition!).getByText(/Modeled EVM-to-Solana transfer/u)).toBeInTheDocument();
    expect(within(composition!).getByLabelText('0 US dollars')).toHaveTextContent('$0.00');
    const fees = screen
      .getByRole('heading', { name: 'Estimated one-time fees' })
      .closest('section');
    expect(within(fees!).getByText('Estimated EVM-Solana transfer costs')).toBeInTheDocument();
    expect(within(fees!).getByText(/No EVM-to-Solana principal transfer/u)).toBeInTheDocument();
    expect(
      screen.getByText(/EVM and Solana managed allocations are included/u),
    ).toBeInTheDocument();
    expectProviderPrivateDom(rendered.container);
  });

  it('labels a direct-compatible platform routing fee as zero', async () => {
    const harness = clientWith({
      previewAllocation: async () => DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW,
    });
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={DIRECT_COMPATIBLE_ZERO_LIQUID_PREVIEW.portfolioSnapshotId}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    const feeSection = (
      await screen.findByRole('heading', { name: 'Estimated one-time fees' })
    ).closest('section');
    const platformRow = within(feeSection!)
      .getByText('Estimated platform routing fee')
      .closest('li');
    expect(platformRow).not.toBeNull();
    expect(
      within(platformRow!).getByText(/Direct-compatible routing has a \$0 platform fee/iu),
    ).toBeInTheDocument();
    expect(within(platformRow!).getByLabelText('0 US dollars')).toHaveTextContent('$0.00');
    expectProviderPrivateDom(rendered.container);
  });

  it('discloses a retained rounding residual as unspent capital and not a fee', async () => {
    const harness = clientWith({
      previewAllocation: async () => RETAINED_ROUNDING_RESIDUAL_PREVIEW,
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={RETAINED_ROUNDING_RESIDUAL_PREVIEW.portfolioSnapshotId}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));

    const reconciliation = (await screen.findByText('Full available capital')).closest('dl');
    expect(reconciliation).not.toBeNull();
    expect(
      within(reconciliation!).getByText('Retained rounding residual (not a fee)'),
    ).toBeInTheDocument();
    expect(within(reconciliation!).getByLabelText('0 US dollars and 1 cent')).toHaveTextContent(
      '$0.01',
    );
    expect(screen.getByText(/retained capital, not a fee or spend/iu)).toBeInTheDocument();
    const feeSection = screen
      .getByRole('heading', { name: 'Estimated one-time fees' })
      .closest('section');
    expect(
      within(feeSection!).queryByText('Retained rounding residual (not a fee)'),
    ).not.toBeInTheDocument();
  });

  it('starts the managed blend with no liquid reserve', async () => {
    const harness = clientWith({});
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    expect(await screen.findByRole('slider')).toHaveValue('0');
    expect(harness.previewAllocation).toHaveBeenNthCalledWith(
      1,
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 0 },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole('slider')).toHaveValue('0');
  });

  it('keeps a keyboard-adjusted liquidity draft separate until its preview is applied', async () => {
    const adjustedPreview = adjustedLiquidityPreview(ZERO_LIQUID_BALANCED_PREVIEW, 3_500);
    let resolveUpdate: ((preview: LocalDemoAllocationPreview) => void) | undefined;
    const pendingUpdate = new Promise<LocalDemoAllocationPreview>((resolve) => {
      resolveUpdate = resolve;
    });
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async () => {
        requestCount += 1;
        return requestCount === 1 ? ZERO_LIQUID_BALANCED_PREVIEW : pendingUpdate;
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    expect(harness.previewAllocation).toHaveBeenNthCalledWith(
      1,
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 0 },
      expect.any(AbortSignal),
    );
    expect(slider).toHaveValue('0');
    expect(slider).toHaveAttribute('aria-valuetext', '0% kept liquid in the draft');
    slider.focus();
    expect(slider).toHaveFocus();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.change(slider, { target: { value: '3500' } });

    expect(slider).toHaveValue('3500');
    expect(slider).toHaveAttribute('aria-valuetext', '35% kept liquid in the draft');
    expect(screen.getByText('Draft 35%')).toBeInTheDocument();
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      /Current applied preview: 0% liquid.*Draft: 35% liquid.*not applied yet/u,
    );
    expect(screen.getByText(/^Keep 0% readily available/u)).toBeInTheDocument();
    expect(harness.previewAllocation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));
    await waitFor(() => expect(harness.previewAllocation).toHaveBeenCalledTimes(2));
    expect(harness.previewAllocation).toHaveBeenNthCalledWith(
      2,
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 3_500 },
      expect.any(AbortSignal),
    );
    const adjustment = screen
      .getByRole('heading', { name: 'Fine-tune this preview' })
      .closest('section');
    expect(adjustment).toHaveAttribute('aria-busy', 'true');
    expect(slider).toBeDisabled();
    expect(screen.getByText(/^Keep 0% readily available/u)).toBeInTheDocument();
    expect(screen.getByText(/current applied preview remains visible/iu)).toBeInTheDocument();

    await act(async () => {
      resolveUpdate?.(adjustedPreview);
      await pendingUpdate;
    });

    expect(await screen.findByText(/^Keep 35% readily available/u)).toBeInTheDocument();
    expect(slider).toBeEnabled();
    expect(slider).toHaveValue('3500');
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      /Current applied preview: 35% liquid.*Draft: 35% liquid.*matches current preview/u,
    );
    expect(screen.getByRole('button', { name: 'Update preview' })).toBeDisabled();
    expect(screen.getByText(/recalculates this preview only/iu)).toBeInTheDocument();
    expect(screen.getByText(/moves no funds/iu)).toBeInTheDocument();
    expect(
      screen.getByText(/applied after costs deducted from gross capital/iu),
    ).toBeInTheDocument();
    expect(screen.getByText(/added-on-top platform fee remains separate/iu)).toBeInTheDocument();
  });

  it('preserves the applied reserve and ignores a newer draft when the blend is reselected', async () => {
    const appliedBalanced = adjustedLiquidityPreview(ZERO_LIQUID_BALANCED_PREVIEW, 3_500);
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async () => {
        requestCount += 1;
        if (requestCount === 1) return ZERO_LIQUID_BALANCED_PREVIEW;
        if (requestCount === 2) return appliedBalanced;
        return appliedBalanced;
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    fireEvent.change(slider, { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));
    expect(await screen.findByText(/^Keep 35% readily available/u)).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '4000' } });
    expect(slider).toHaveValue('4000');
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      /Current applied preview: 35% liquid.*Draft: 40% liquid.*not applied yet/u,
    );
    fireEvent.click(screen.getByRole('button', { name: /Managed blend/u }));

    await waitFor(() => expect(harness.previewAllocation).toHaveBeenCalledTimes(3));
    expect(harness.previewAllocation).toHaveBeenNthCalledWith(
      3,
      PORTFOLIO_SNAPSHOT_ID,
      { kind: 'PRESET', presetId: 'BALANCED', liquidReserveBasisPoints: 3_500 },
      expect.any(AbortSignal),
    );
    const balancedSlider = await screen.findByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    expect(balancedSlider).toHaveValue('3500');
    expect(screen.getByRole('button', { name: /Managed blend/u })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('retains the applied preview and changed draft when a liquidity update fails', async () => {
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async () => {
        requestCount += 1;
        if (requestCount === 1) return ZERO_LIQUID_BALANCED_PREVIEW;
        throw new LocalDemoApiError('UNAVAILABLE');
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    fireEvent.change(slider, { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/current applied preview has not changed/u);
    expect(alert).toHaveTextContent(/no funds were moved/u);
    expect(screen.getByText(/^Keep 0% readily available/u)).toBeInTheDocument();
    expect(screen.getByText(/Current applied preview:/u)).toHaveTextContent(
      /Current applied preview: 0% liquid.*Draft: 35% liquid.*not applied yet/u,
    );
    expect(slider).toHaveValue('3500');
    expect(screen.getByRole('button', { name: 'Update preview' })).toBeEnabled();
  });

  it('clears an applied preview and refreshes the portfolio when a liquidity update conflicts', async () => {
    const onPortfolioSnapshotChanged = vi.fn();
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async () => {
        requestCount += 1;
        if (requestCount === 1) return ZERO_LIQUID_BALANCED_PREVIEW;
        throw new LocalDemoApiError('PORTFOLIO_SNAPSHOT_CHANGED');
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
        onPortfolioSnapshotChanged={onPortfolioSnapshotChanged}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    fireEvent.change(slider, { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));

    expect(
      await screen.findByText(/connected-wallet portfolio changed before this preview completed/iu),
    ).toBeInTheDocument();
    expect(onPortfolioSnapshotChanged).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('slider', {
        name: 'Share of projected capital kept liquid after deducted costs',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Illustrative yield result' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Managed blend/u })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('renders explicit no-yield and beyond-horizon first-positive states', async () => {
    const noYield: LocalDemoAllocationPreview = Object.freeze({
      ...ZERO_LIQUID_BALANCED_PREVIEW,
      yieldProjection: Object.freeze({
        ...ZERO_LIQUID_BALANCED_PREVIEW.yieldProjection,
        effectiveApyBasisPoints: 0,
        projectedAnnualYieldUsdMinor: '0',
        projectedAnnualYieldAfterFeesUsdMinor: '-2273',
        firstPositiveDayAfterFees: Object.freeze({
          ...ZERO_LIQUID_BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees,
          status: 'NO_PROJECTED_YIELD',
          day: null,
        }),
      }),
    });
    const beyondHorizon: LocalDemoAllocationPreview = Object.freeze({
      ...ZERO_LIQUID_BALANCED_PREVIEW,
      yieldProjection: Object.freeze({
        ...ZERO_LIQUID_BALANCED_PREVIEW.yieldProjection,
        effectiveApyBasisPoints: 25,
        projectedAnnualYieldUsdMinor: '100',
        projectedAnnualYieldAfterFeesUsdMinor: '-2173',
        firstPositiveDayAfterFees: Object.freeze({
          ...ZERO_LIQUID_BALANCED_PREVIEW.yieldProjection.firstPositiveDayAfterFees,
          status: 'NOT_RECOVERED_WITHIN_HORIZON',
          day: null,
        }),
      }),
    });
    const previews = [noYield, beyondHorizon];
    const harness = clientWith({ previewAllocation: async () => previews.shift()! });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    expect(await screen.findByText('No projected yield')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Managed blend/u }));
    expect(await screen.findByText('Not within 1 year')).toBeInTheDocument();
  });

  it('retries an unavailable managed rate set in place', async () => {
    const readYieldCatalog = vi
      .fn()
      .mockRejectedValueOnce(new LocalDemoApiError('UNAVAILABLE'))
      .mockResolvedValueOnce(LOCAL_DEMO_YIELD_CATALOG);
    const harness = clientWith({ readYieldCatalog });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    expect(await screen.findByText(/managed rate set could not be validated/u)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry rates' }));

    expect(
      await screen.findByRole('heading', { name: 'Crypto Lending managed blend' }),
    ).toBeInTheDocument();
    expect(harness.readYieldCatalog).toHaveBeenCalledTimes(2);
  });

  it('clears selection and requests a portfolio refresh on a snapshot conflict', async () => {
    const onPortfolioSnapshotChanged = vi.fn();
    const harness = clientWith({
      previewAllocation: async () => {
        throw new LocalDemoApiError('PORTFOLIO_SNAPSHOT_CHANGED');
      },
    });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
        onPortfolioSnapshotChanged={onPortfolioSnapshotChanged}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));

    expect(
      await screen.findByText(/connected-wallet portfolio changed before this preview completed/iu),
    ).toHaveAttribute('role', 'alert');
    expect(onPortfolioSnapshotChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Managed blend/u })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.queryByRole('heading', { name: 'Managed allocation by ecosystem' }),
    ).not.toBeInTheDocument();
  });

  it('labels rates stale at their boundary and reconciles a stale preview', async () => {
    const now = Date.now();
    const catalog: LocalDemoYieldCatalog = Object.freeze({
      ...LOCAL_DEMO_YIELD_CATALOG,
      snapshot: Object.freeze({
        ...LOCAL_DEMO_YIELD_CATALOG.snapshot,
        capturedAt: new Date(now - 1_000).toISOString(),
        staleAfter: new Date(now + 100).toISOString(),
        freshness: 'CURRENT',
      }),
    });
    const preview: LocalDemoAllocationPreview = Object.freeze({
      ...ZERO_LIQUID_BALANCED_PREVIEW,
      rateSnapshot: Object.freeze({
        ...ZERO_LIQUID_BALANCED_PREVIEW.rateSnapshot,
        capturedAt: catalog.snapshot.capturedAt,
        staleAfter: catalog.snapshot.staleAfter,
        freshness: 'STALE',
      }),
    });
    const harness = clientWith({ catalog, previewAllocation: async () => preview });
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );

    expect(await screen.findByText('Rates current')).toBeInTheDocument();
    expect(
      await screen.findByText(/Archived rates.*stale/u, {}, { timeout: 1_000 }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Managed blend/u }));
    expect(await screen.findByText(/managed rate set is stale/u)).toBeInTheDocument();
    expect(
      screen.getByText('No user-authorized financial transaction was created.'),
    ).toBeInTheDocument();
  });

  it('aborts an applied-liquidity request and ignores a late response after unmount', async () => {
    const adjustedPreview = adjustedLiquidityPreview(ZERO_LIQUID_BALANCED_PREVIEW, 3_500);
    let previewSignal: AbortSignal | undefined;
    let resolveLatePreview: ((preview: LocalDemoAllocationPreview) => void) | undefined;
    const latePreview = new Promise<LocalDemoAllocationPreview>((resolve) => {
      resolveLatePreview = resolve;
    });
    let requestCount = 0;
    const harness = clientWith({
      previewAllocation: async (_portfolioSnapshotId, _selection, signal) => {
        requestCount += 1;
        if (requestCount === 1) return ZERO_LIQUID_BALANCED_PREVIEW;
        previewSignal = signal;
        return latePreview;
      },
    });
    const rendered = render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    const slider = await screen.findByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    fireEvent.change(slider, { target: { value: '3500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update preview' }));
    await waitFor(() => expect(harness.previewAllocation).toHaveBeenCalledTimes(2));

    rendered.unmount();

    expect(previewSignal?.aborted).toBe(true);
    await act(async () => {
      resolveLatePreview?.(adjustedPreview);
      await latePreview;
    });
    expect(harness.previewAllocation).toHaveBeenCalledTimes(2);
  });

  it('shows review only for the applied draft and locks allocation controls through signature recovery', async () => {
    const descriptor = {
      selectionId: 'phantom:1',
      displayName: 'Phantom' as const,
      supportedTransactionVersions: ['legacy', 0] as const,
    };
    const selected: SelectedSolanaWallet = {
      descriptor,
      wallet: {} as Wallet,
    };
    let resolveSignature!: (signature: string) => void;
    const pendingSignature = new Promise<string>((resolve) => {
      resolveSignature = resolve;
    });
    const signTransaction = vi.fn(async () => ({
      signature: await pendingSignature,
      serializedTransaction: Uint8Array.of(1, 2, 3),
    }));
    const wallet: SolanaPublicTestnetWalletPort = {
      connect: vi.fn(async () => PUBLIC_TESTNET_ACCOUNT),
      readSnapshot: vi.fn(async () => ({
        account: PUBLIC_TESTNET_ACCOUNT,
        correctNetwork: true as const,
      })),
      signTransaction,
      subscribeInvalidation: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const proofDependencies: PublicTestnetProofDependencies = {
      createApi: () => ({
        createIntent: vi.fn(async () => publicTestnetIntent()),
        submitTransaction: vi.fn(async () => publicTestnetSubmission('PENDING')),
        submitSignedTransaction: vi.fn(async () => publicTestnetSubmission('PENDING')),
        readPosition: vi.fn(async () => publicTestnetPosition()),
      }),
      createDiscovery: () => ({
        start: vi.fn(),
        stop: vi.fn(),
        list: () => [descriptor],
        subscribe: () => vi.fn(),
        select: (selectionId) => (selectionId === descriptor.selectionId ? selected : null),
      }),
      createWallet: () => wallet,
      now: () => PUBLIC_TESTNET_NOW,
    };
    const evmDescriptor: InjectedProviderDescriptor = {
      selectionId: 'metamask:recovery-lock',
      connectorId: 'metamask',
      displayName: 'MetaMask',
      supportedNetworks: [
        {
          chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
          providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
          displayName: 'Base Sepolia',
          environment: 'TESTNET',
        },
      ],
    };
    const selectedEvm: SelectedEip1193Provider = {
      descriptor: evmDescriptor,
      provider: {} as SelectedEip1193Provider['provider'],
    };
    const evmWallet: EvmPublicTestnetWalletPort = {
      connect: vi.fn(async () => EVM_PUBLIC_TESTNET_ACCOUNT),
      readSnapshot: vi.fn(async () => ({
        account: EVM_PUBLIC_TESTNET_ACCOUNT,
        chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
        providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
        correctNetwork: true as const,
      })),
      sendTransaction: vi.fn(async () => ({
        transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      })),
      subscribeInvalidation: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const evmIntent = parseEvmPublicTestnetExecutionIntent(
      evmPublicTestnetIntentResponse(),
      evmPublicTestnetRequest(),
      EVM_PUBLIC_TESTNET_NOW,
    );
    const evmPending = parseEvmPublicTestnetSubmissionResult(
      evmPublicTestnetSubmissionResponse('PENDING'),
      {
        intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
        transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      },
    );
    const evmProofDependencies: EvmPublicTestnetProofDependencies = {
      createApi: () => ({
        prepare: vi.fn(async () => evmIntent),
        submit: vi.fn(async () => evmPending),
        query: vi.fn(async () => evmPending),
        queryPosition: vi.fn(async () =>
          parseEvmPublicTestnetPositionSnapshot(evmPublicTestnetPositionResponse(), {
            chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
            account: EVM_PUBLIC_TESTNET_ACCOUNT,
          }),
        ),
      }),
      createDiscovery: () => ({
        start: vi.fn(),
        stop: vi.fn(),
        list: () => [evmDescriptor],
        subscribe: () => vi.fn(),
        select: (selectionId) => (selectionId === evmDescriptor.selectionId ? selectedEvm : null),
      }),
      createWallet: () => evmWallet,
      now: () => EVM_PUBLIC_TESTNET_NOW,
    };
    const harness = clientWith({});
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
        publicTestnetProofDependencies={proofDependencies}
        evmPublicTestnetProofDependencies={evmProofDependencies}
      />,
    );
    const managedBlend = await screen.findByRole('button', { name: /Managed blend/u });
    await waitFor(() => expect(managedBlend).toBeEnabled());
    fireEvent.click(managedBlend);
    const slider = await screen.findByRole('slider', {
      name: 'Share of projected capital kept liquid after deducted costs',
    });
    expect(
      await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }),
    ).toBeEnabled();

    fireEvent.change(slider, { target: { value: '500' } });
    expect(screen.queryByRole('button', { name: 'Review 0.01 SOL Devnet proof' })).toBeNull();
    fireEvent.change(slider, { target: { value: '0' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review 0.00005 ETH EVM testnet proof' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect MetaMask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Phantom' }));
    const evmProof = screen.getByRole('region', {
      name: 'Try one real Base Sepolia lending position',
    });
    const svmProof = screen.getByRole('region', { name: 'Try one real testnet lending position' });
    await within(evmProof).findByText(/Confirm the EVM disclosure/iu);
    await within(svmProof).findByText(/Confirm the Solana disclosure/iu);
    const lendingDashboard = screen.getByRole('region', {
      name: 'Your Devnet lending position',
    });
    const allocationPanel = screen
      .getByRole('heading', { name: 'Preview your managed allocation.' })
      .closest('section');
    expect(await within(lendingDashboard).findByText(/0\.010000 SOL/u)).toBeInTheDocument();
    const dashboardOverview = screen.getByRole('region', { name: 'Your lending dashboards' });
    expect(
      within(dashboardOverview).getByRole('region', { name: 'Your Base Sepolia position' }),
    ).toBeInTheDocument();
    expect(
      within(dashboardOverview).getByRole('region', { name: 'Your Devnet lending position' }),
    ).toBe(lendingDashboard);
    expect(dashboardOverview.nextElementSibling).toBe(allocationPanel);
    expect(document.querySelectorAll('#public-testnet-lending-dashboard')).toHaveLength(1);
    expect(signTransaction).not.toHaveBeenCalled();
    fireEvent.click(within(evmProof).getByRole('checkbox'));
    fireEvent.click(within(svmProof).getByRole('checkbox'));
    const combinedSubmit = screen.getByRole('button', { name: 'Submit both testnet deposits' });
    await waitFor(() => expect(combinedSubmit).toBeEnabled());
    fireEvent.click(combinedSubmit);

    await waitFor(() => expect(signTransaction).toHaveBeenCalledTimes(1));
    expect(evmWallet.sendTransaction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(slider).toBeDisabled());
    expect(screen.getByRole('button', { name: /Managed blend/u })).toBeDisabled();
    await act(async () => resolveSignature(PUBLIC_TESTNET_SIGNATURE));
    expect(
      await screen.findByRole('button', { name: 'Check server verification' }),
    ).toBeInTheDocument();
    expect(slider).toBeDisabled();
    expect(signTransaction).toHaveBeenCalledTimes(1);

    expect(within(svmProof).getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(slider).toBeDisabled();
    expect(screen.getByText(/do not start another proof/iu)).toBeInTheDocument();
  });

  it('launches exactly one EVM and one SVM transaction from the single combined button', async () => {
    const evmDescriptor: InjectedProviderDescriptor = {
      selectionId: 'metamask:1',
      connectorId: 'metamask',
      displayName: 'MetaMask',
      supportedNetworks: [
        {
          chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
          providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
          displayName: 'Base Sepolia',
          environment: 'TESTNET',
        },
      ],
    };
    const selectedEvm: SelectedEip1193Provider = {
      descriptor: evmDescriptor,
      provider: {} as SelectedEip1193Provider['provider'],
    };
    let resolveEvmSend!: (value: { transactionHash: string }) => void;
    const pendingEvmSend = new Promise<{ transactionHash: string }>((resolve) => {
      resolveEvmSend = resolve;
    });
    const sendTransaction = vi.fn(async () => pendingEvmSend);
    const evmWallet: EvmPublicTestnetWalletPort = {
      connect: vi.fn(async () => EVM_PUBLIC_TESTNET_ACCOUNT),
      readSnapshot: vi.fn(async () => ({
        account: EVM_PUBLIC_TESTNET_ACCOUNT,
        chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
        providerChainId: EVM_PUBLIC_TESTNET_PROVIDER_CHAIN_ID,
        correctNetwork: true as const,
      })),
      sendTransaction,
      subscribeInvalidation: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const evmIntent = parseEvmPublicTestnetExecutionIntent(
      evmPublicTestnetIntentResponse(),
      evmPublicTestnetRequest(),
      EVM_PUBLIC_TESTNET_NOW,
    );
    const evmPending = parseEvmPublicTestnetSubmissionResult(
      evmPublicTestnetSubmissionResponse('PENDING'),
      {
        intentId: EVM_PUBLIC_TESTNET_INTENT_ID,
        transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH,
      },
    );
    const evmPosition = parseEvmPublicTestnetPositionSnapshot(evmPublicTestnetPositionResponse(), {
      chainId: EVM_PUBLIC_TESTNET_CHAIN_ID,
      account: EVM_PUBLIC_TESTNET_ACCOUNT,
    });
    const evmProofDependencies: EvmPublicTestnetProofDependencies = {
      createApi: () => ({
        prepare: vi.fn(async () => evmIntent),
        submit: vi.fn(async () => evmPending),
        query: vi.fn(async () => evmPending),
        queryPosition: vi.fn(async () => evmPosition),
      }),
      createDiscovery: () => ({
        start: vi.fn(),
        stop: vi.fn(),
        list: () => [evmDescriptor],
        subscribe: () => vi.fn(),
        select: (selectionId) => (selectionId === evmDescriptor.selectionId ? selectedEvm : null),
      }),
      createWallet: () => evmWallet,
      now: () => EVM_PUBLIC_TESTNET_NOW,
    };

    const svmDescriptor = {
      selectionId: 'phantom:1',
      displayName: 'Phantom' as const,
      supportedTransactionVersions: ['legacy', 0] as const,
    };
    const selectedSvm: SelectedSolanaWallet = {
      descriptor: svmDescriptor,
      wallet: {} as Wallet,
    };
    let resolveSvmSignature!: (signature: string) => void;
    const pendingSvmSignature = new Promise<string>((resolve) => {
      resolveSvmSignature = resolve;
    });
    const signTransaction = vi.fn(async () => ({
      signature: await pendingSvmSignature,
      serializedTransaction: Uint8Array.of(1, 2, 3),
    }));
    const svmWallet: SolanaPublicTestnetWalletPort = {
      connect: vi.fn(async () => PUBLIC_TESTNET_ACCOUNT),
      readSnapshot: vi.fn(async () => ({
        account: PUBLIC_TESTNET_ACCOUNT,
        correctNetwork: true as const,
      })),
      signTransaction,
      subscribeInvalidation: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    };
    const svmProofDependencies: PublicTestnetProofDependencies = {
      createApi: () => ({
        createIntent: vi.fn(async () => publicTestnetIntent()),
        submitTransaction: vi.fn(async () => publicTestnetSubmission('PENDING')),
        submitSignedTransaction: vi.fn(async () => publicTestnetSubmission('PENDING')),
        readPosition: vi.fn(async () => publicTestnetPosition()),
      }),
      createDiscovery: () => ({
        start: vi.fn(),
        stop: vi.fn(),
        list: () => [svmDescriptor],
        subscribe: () => vi.fn(),
        select: (selectionId) => (selectionId === svmDescriptor.selectionId ? selectedSvm : null),
      }),
      createWallet: () => svmWallet,
      now: () => PUBLIC_TESTNET_NOW,
    };

    const harness = clientWith({});
    render(
      <LocalDemoAllocationPlanner
        client={harness.client}
        portfolioSnapshotId={PORTFOLIO_SNAPSHOT_ID}
        publicTestnetProofDependencies={svmProofDependencies}
        evmPublicTestnetProofDependencies={evmProofDependencies}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Managed blend/u }));
    const combinedSubmit = await screen.findByRole('button', {
      name: 'Submit both testnet deposits',
    });
    expect(combinedSubmit).toBeDisabled();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Review 0.00005 ETH EVM testnet proof' }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Review 0.01 SOL Devnet proof' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect MetaMask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Phantom' }));

    const evmProof = screen.getByRole('region', {
      name: 'Try one real Base Sepolia lending position',
    });
    const svmProof = screen.getByRole('region', { name: 'Try one real testnet lending position' });
    await within(evmProof).findByText(/Confirm the EVM disclosure/iu);
    await within(svmProof).findByText(/Confirm the Solana disclosure/iu);
    expect(
      within(evmProof).queryByRole('button', { name: 'Submit Base Sepolia transaction' }),
    ).toBeNull();
    expect(
      within(svmProof).queryByRole('button', { name: 'Submit Devnet transaction' }),
    ).toBeNull();
    fireEvent.click(within(evmProof).getByRole('checkbox'));
    await waitFor(() => {
      expect(combinedSubmit).toBeDisabled();
      expect(screen.getByText(/EVM is ready.*Solana review/iu)).toBeInTheDocument();
    });
    fireEvent.click(within(svmProof).getByRole('checkbox'));

    await waitFor(() => expect(combinedSubmit).toBeEnabled());
    expect(
      screen.getByText(/One click starts two independent wallet approvals/iu),
    ).toBeInTheDocument();
    fireEvent.click(combinedSubmit);
    fireEvent.click(combinedSubmit);
    await waitFor(() => {
      expect(sendTransaction).toHaveBeenCalledTimes(1);
      expect(signTransaction).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: 'Complete both wallet approvals' })).toBeDisabled();

    expect(within(evmProof).getByText(/Review the 0\.00005 ETH deposit/iu)).toBeInTheDocument();
    expect(within(svmProof).getByText(/Review the 0\.01 SOL Devnet deposit/iu)).toBeInTheDocument();
    expect(within(evmProof).getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(within(svmProof).getByRole('button', { name: 'Close' })).toBeDisabled();

    await act(async () => {
      resolveEvmSend({ transactionHash: EVM_PUBLIC_TESTNET_TRANSACTION_HASH });
      resolveSvmSignature(PUBLIC_TESTNET_SIGNATURE);
    });
    expect(
      await within(evmProof).findByRole('button', { name: 'Check EVM verification' }),
    ).toBeInTheDocument();
    expect(
      await within(svmProof).findByRole('button', { name: 'Check server verification' }),
    ).toBeInTheDocument();
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(signTransaction).toHaveBeenCalledTimes(1);
  });
});
