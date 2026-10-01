import { MAINNET_TEST } from '../mainnet/policy';

export function localMainnetConfig(environment: Record<string, string | undefined> = process.env) {
  if (environment.LOCAL_MAINNET_TEST_MODE !== 'enabled' || environment.NODE_ENV !== 'development') return null;
  if (!/^[a-f0-9]{64}$/.test(environment.LOCAL_MAINNET_TEST_LAUNCH_TOKEN ?? '')) return null;
  if (environment.LOCAL_DEMO_MODE === 'enabled' || environment.DEPLOYMENT_TARGET) return null;
  return { origin: MAINNET_TEST.origin };
}

export function isLocalMainnetRequest(request: Pick<Request, 'url' | 'headers'>, mutation: boolean): boolean {
  const parsed = new URL(request.url);
  // Next's Node adapter normalizes request.url to localhost; the original Host
  // and mutation Origin must still name the one allowed loopback address.
  return [MAINNET_TEST.origin, 'http://localhost:3000'].includes(parsed.origin) &&
    request.headers.get('host') === '127.0.0.1:3000' &&
    !request.headers.has('forwarded') &&
    (!request.headers.has('x-forwarded-host') || request.headers.get('x-forwarded-host') === '127.0.0.1:3000') &&
    (!request.headers.has('x-forwarded-for') || ['127.0.0.1', '::ffff:127.0.0.1'].includes(request.headers.get('x-forwarded-for')!)) &&
    (!request.headers.has('x-forwarded-proto') || request.headers.get('x-forwarded-proto') === 'http') &&
    (!request.headers.has('origin') || request.headers.get('origin') === MAINNET_TEST.origin) &&
    (!request.headers.has('sec-fetch-site') || ['none', 'same-origin'].includes(request.headers.get('sec-fetch-site')!)) &&
    (!mutation || request.headers.get('origin') === MAINNET_TEST.origin);
}
