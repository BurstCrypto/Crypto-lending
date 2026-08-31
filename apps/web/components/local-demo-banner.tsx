export const LOCAL_DEMO_BANNER_TEXT =
  'Synthetic local portfolio data — no real-value assets; only the labeled Devnet proof and dashboard make live public-chain requests';

export function LocalDemoBanner({ enabled }: Readonly<{ enabled: boolean }>) {
  if (!enabled) return null;

  return (
    <div className="local-demo-banner" role="status" aria-label="Local demo mode">
      {LOCAL_DEMO_BANNER_TEXT}
    </div>
  );
}
