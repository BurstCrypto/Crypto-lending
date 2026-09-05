'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { replaceBrowserLocation } from '@/components/authentication/browser-navigation';
import {
  AuthenticationUnauthenticatedError,
  restoreAuthenticationSession,
  type AccountProfile,
} from '@/lib/authentication';
import { isAbortFailure } from '@/lib/authentication/http';
import { useSensitiveViewRevalidation } from '@/lib/browser/use-sensitive-view-revalidation';
import type {
  MainnetPlatformCandidate,
  MainnetPlatformDirectory,
} from '@/lib/platforms/mainnet-platform-directory';
import {
  isMainnetPlatformsUnauthenticated,
  MainnetPlatformsApiClient,
  MainnetPlatformsApiError,
} from '@/lib/platforms/mainnet-platforms-client';

const PLATFORMS_LOGIN_PATH = '/login?returnTo=%2Fplatforms';

interface PlatformDirectoryReader {
  readDirectory(signal?: AbortSignal): Promise<MainnetPlatformDirectory>;
}

interface ProductionPlatformDirectoryDependencies {
  readonly createClient: () => PlatformDirectoryReader;
  readonly navigate: (path: string) => void;
  readonly restoreSession: (options: { readonly signal?: AbortSignal }) => Promise<AccountProfile>;
}

export interface ProductionPlatformDirectoryProps {
  /** Deterministic injection boundary for focused browser tests. */
  readonly dependencies?: Partial<ProductionPlatformDirectoryDependencies>;
}

type DirectoryState =
  | Readonly<{ status: 'LOADING' }>
  | Readonly<{ status: 'ERROR' }>
  | Readonly<{ status: 'UNAVAILABLE' }>
  | Readonly<{ status: 'READY'; directory: MainnetPlatformDirectory }>;

const DEFAULT_DEPENDENCIES: ProductionPlatformDirectoryDependencies = Object.freeze({
  createClient: () => new MainnetPlatformsApiClient(),
  navigate: replaceBrowserLocation,
  restoreSession: restoreAuthenticationSession,
});

function dependenciesFor(
  overrides: Partial<ProductionPlatformDirectoryDependencies> | undefined,
): ProductionPlatformDirectoryDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...overrides };
}

function readableEcosystem(candidate: MainnetPlatformCandidate): string {
  return candidate.ecosystem === 'EVM' ? 'Ethereum' : 'Solana';
}

function PlatformCard({ candidate }: { readonly candidate: MainnetPlatformCandidate }) {
  return (
    <article className="platform-card" aria-labelledby={`platform-${candidate.id}-name`}>
      <div className="platform-card__heading">
        <div>
          <p className="platform-ecosystem">{readableEcosystem(candidate)}</p>
          <h3 id={`platform-${candidate.id}-name`}>{candidate.name}</h3>
        </div>
        <span className="platform-status platform-status--planned">Planned</span>
      </div>

      <dl className="platform-details">
        <div>
          <dt>Protocol</dt>
          <dd>{candidate.protocol}</dd>
        </div>
        <div>
          <dt>Market data</dt>
          <dd>Not connected</dd>
        </div>
        <div>
          <dt>User access</dt>
          <dd>Unavailable</dd>
        </div>
        <div>
          <dt>Risk review</dt>
          <dd>Not assessed</dd>
        </div>
      </dl>

      <div className="platform-networks">
        <p>Planned networks</p>
        <ul aria-label={`${candidate.name} planned networks`}>
          {candidate.networks.map((network) => (
            <li key={network.id}>{network.name}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function LoadingView() {
  return (
    <section className="platform-directory-state" aria-labelledby="platform-directory-loading">
      <div role="status" aria-live="polite" aria-busy="true">
        <div className="portfolio-loading-mark" aria-hidden="true" />
        <h2 id="platform-directory-loading">Loading the platform directory</h2>
        <p>No provider information is shown until your session and the response are verified.</p>
      </div>
    </section>
  );
}

function FailureView({ unavailable }: { readonly unavailable: boolean }) {
  return (
    <section
      className={`platform-directory-state ${
        unavailable ? 'platform-directory-state--unavailable' : 'platform-directory-state--error'
      }`}
      aria-labelledby="platform-directory-failure"
    >
      <div role={unavailable ? 'status' : 'alert'}>
        <span className="portfolio-state-mark" aria-hidden="true">
          {unavailable ? 'i' : '!'}
        </span>
        <h2 id="platform-directory-failure">
          {unavailable
            ? 'Platform directory is unavailable'
            : 'Platform directory could not be loaded'}
        </h2>
        <p>
          {unavailable
            ? 'Verified platform information is not available right now.'
            : 'The response could not be verified, so no provider information is displayed.'}
        </p>
      </div>
    </section>
  );
}

function ReadyView({ directory }: { readonly directory: MainnetPlatformDirectory }) {
  return (
    <section className="platform-directory" aria-labelledby="platform-directory-title">
      <div className="platform-directory__summary" role="status">
        <strong>{directory.providers.length} platforms under evaluation</strong>
        <span aria-hidden="true">·</span>
        <span>0 available now</span>
      </div>

      <div className="platform-directory__notice" role="note">
        <span aria-hidden="true">i</span>
        <p>
          <strong>Planning directory only.</strong> Market data is not connected and no lending,
          deposit, withdrawal, approval, or transaction action is enabled.
        </p>
      </div>

      <div className="platform-directory__heading">
        <div>
          <p className="eyebrow">Provider candidates</p>
          <h2 id="platform-directory-title">Platforms we are preparing for review</h2>
        </div>
        <p>
          A planned listing is not an endorsement or a promise of availability. Every integration
          remains subject to technical, security, asset, and operational approval.
        </p>
      </div>

      <div className="platform-grid">
        {directory.providers.map((candidate) => (
          <PlatformCard key={candidate.id} candidate={candidate} />
        ))}
      </div>
    </section>
  );
}

export function ProductionPlatformDirectory({ dependencies }: ProductionPlatformDirectoryProps) {
  const configured = useMemo(() => dependenciesFor(dependencies), [dependencies]);
  const [phase, setPhase] = useState<'CHECKING_SESSION' | 'AUTHENTICATED' | 'SIGNED_OUT'>(
    'CHECKING_SESSION',
  );
  const [directory, setDirectory] = useState<DirectoryState>({ status: 'LOADING' });
  const [revision, setRevision] = useState(0);
  const requestReference = useRef<AbortController | null>(null);
  const requestGenerationReference = useRef(0);

  const invalidateSensitiveView = useCallback((): void => {
    requestGenerationReference.current += 1;
    requestReference.current?.abort();
    setDirectory({ status: 'LOADING' });
    setPhase('CHECKING_SESSION');
  }, []);

  const revalidateSensitiveView = useCallback((): void => {
    setRevision((current) => current + 1);
  }, []);

  const isSensitiveViewActive = useSensitiveViewRevalidation({
    enabled: phase !== 'SIGNED_OUT',
    invalidate: invalidateSensitiveView,
    revalidate: revalidateSensitiveView,
  });

  useEffect(() => {
    if (!isSensitiveViewActive()) return;
    const controller = new AbortController();
    const generation = requestGenerationReference.current;
    requestReference.current?.abort();
    requestReference.current = controller;

    const isCurrentRequest = (): boolean =>
      !controller.signal.aborted && requestGenerationReference.current === generation;

    async function load(): Promise<void> {
      try {
        await configured.restoreSession({ signal: controller.signal });
        if (!isCurrentRequest()) return;
        setPhase('AUTHENTICATED');
        const response = await configured.createClient().readDirectory(controller.signal);
        if (!isCurrentRequest()) return;
        setDirectory({ status: 'READY', directory: response });
      } catch (error) {
        if (!isCurrentRequest() || isAbortFailure(error, controller.signal)) return;
        if (
          error instanceof AuthenticationUnauthenticatedError ||
          isMainnetPlatformsUnauthenticated(error)
        ) {
          setDirectory({ status: 'LOADING' });
          setPhase('SIGNED_OUT');
          return;
        }
        setDirectory(
          error instanceof MainnetPlatformsApiError && error.code === 'UNAVAILABLE'
            ? { status: 'UNAVAILABLE' }
            : { status: 'ERROR' },
        );
      }
    }

    void load();
    return () => {
      controller.abort();
      if (requestReference.current === controller) requestReference.current = null;
    };
  }, [configured, isSensitiveViewActive, revision]);

  useEffect(() => {
    if (phase === 'SIGNED_OUT') configured.navigate(PLATFORMS_LOGIN_PATH);
  }, [configured, phase]);

  function retry(): void {
    invalidateSensitiveView();
    revalidateSensitiveView();
  }

  if (phase === 'SIGNED_OUT' || directory.status === 'LOADING') {
    return <LoadingView />;
  }

  if (phase === 'CHECKING_SESSION') {
    return (
      <div className="platform-directory-failure">
        <FailureView unavailable={directory.status === 'UNAVAILABLE'} />
        <button className="platform-retry" type="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }

  if (directory.status === 'READY') return <ReadyView directory={directory.directory} />;

  return (
    <div className="platform-directory-failure">
      <FailureView unavailable={directory.status === 'UNAVAILABLE'} />
      <button className="platform-retry" type="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
