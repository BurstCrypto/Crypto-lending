export type SanitizedWalletErrorCode =
  | 'user-rejected'
  | 'request-pending'
  | 'unsupported-chain'
  | 'wallet-unavailable'
  | 'request-failed';

export interface SanitizedWalletError {
  readonly code: SanitizedWalletErrorCode;
  readonly message: string;
}

function readErrorField(error: unknown, field: 'code' | 'name'): unknown {
  try {
    return typeof error === 'object' && error !== null ? Reflect.get(error, field) : undefined;
  } catch {
    return undefined;
  }
}

export function sanitizeEvmWalletError(error: unknown): SanitizedWalletError {
  const code = readErrorField(error, 'code');
  const name = readErrorField(error, 'name');

  if (code === 4001 || code === '4001' || name === 'UserRejectedRequestError') {
    return { code: 'user-rejected', message: 'The wallet request was rejected.' };
  }
  if (code === -32002 || code === '-32002' || name === 'ResourceUnavailableRpcError') {
    return { code: 'request-pending', message: 'A wallet request is already pending.' };
  }
  if (code === 4902 || code === '4902' || name === 'SwitchChainNotSupportedError') {
    return { code: 'unsupported-chain', message: 'The wallet cannot switch to that testnet.' };
  }
  if (name === 'ProviderNotFoundError' || name === 'ConnectorNotFoundError') {
    return { code: 'wallet-unavailable', message: 'The selected wallet is unavailable.' };
  }
  return { code: 'request-failed', message: 'The wallet could not complete the request.' };
}

export function shortenWalletAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
