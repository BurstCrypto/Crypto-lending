export interface BrowserSecurityHeader {
  key: string;
  value: string;
}

export function buildBrowserEgressPolicy(runtime: string | undefined): string;
export function buildRestrictedWalletLabPolicy(runtime: string | undefined): string;
export function buildBrowserSecurityHeaders(runtime: string | undefined): BrowserSecurityHeader[];
export function buildRestrictedWalletLabSecurityHeaders(
  runtime: string | undefined,
): BrowserSecurityHeader[];
