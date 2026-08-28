export type PublicTestnetOperatorEnvironment = Readonly<{
  CI?: string | undefined;
  NODE_ENV?: string | undefined;
}>;

/** Keeps live public-RPC traffic an explicit local-development action. */
export function assertLocalPublicTestnetOperatorBoundary(
  environment: PublicTestnetOperatorEnvironment,
): void {
  if (environment.NODE_ENV?.trim().toLowerCase() === 'production') {
    throw new Error('PUBLIC_TESTNET_LIVE_PRODUCTION_BLOCKED');
  }

  const ci = environment.CI?.trim().toLowerCase();
  if (ci && ci !== 'false' && ci !== '0') {
    throw new Error('PUBLIC_TESTNET_LIVE_CI_BLOCKED');
  }
}
