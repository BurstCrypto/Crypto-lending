const PRODUCTION_CONNECT_POLICY = "connect-src 'self'";
const LOCAL_DEVELOPMENT_CONNECT_POLICY = "connect-src 'self' ws://127.0.0.1:* ws://localhost:*";
const PRODUCTION_SCRIPT_POLICY = "script-src 'self' 'unsafe-inline'";
const LOCAL_DEVELOPMENT_SCRIPT_POLICY = "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
const BASE_RESOURCE_POLICY =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; frame-src 'none'; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";

export function buildBrowserEgressPolicy(runtime: string | undefined): string {
  const localRuntime = runtime === 'development' || runtime === 'test';
  const connectPolicy = localRuntime ? LOCAL_DEVELOPMENT_CONNECT_POLICY : PRODUCTION_CONNECT_POLICY;
  const scriptPolicy = localRuntime ? LOCAL_DEVELOPMENT_SCRIPT_POLICY : PRODUCTION_SCRIPT_POLICY;

  return `${connectPolicy}; ${scriptPolicy}; ${BASE_RESOURCE_POLICY}`;
}

export function buildRestrictedWalletLabPolicy(runtime: string | undefined): string {
  return buildBrowserEgressPolicy(runtime);
}
