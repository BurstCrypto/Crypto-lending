export const LOCAL_DEMO_BANNER_TEXT =
  'Synthetic local demo data — no real assets, providers, or transactions';

export function LocalDemoBanner({ enabled }: Readonly<{ enabled: boolean }>) {
  if (!enabled) return null;

  return (
    <div className="local-demo-banner" role="status" aria-label="Local demo mode">
      {LOCAL_DEMO_BANNER_TEXT}
    </div>
  );
}
