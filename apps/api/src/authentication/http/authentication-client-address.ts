import { BlockList, isIP } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';

import {
  AUTHENTICATION_CLIENT_ADDRESS_CONFIG,
  canonicalAuthenticationIpAddress,
  type AuthenticationClientAddressConfig,
} from '../infrastructure/config/authentication-client-address.config';

export interface AuthenticationClientAddressRequest {
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly rawHeaders?: unknown;
  readonly socket?: { readonly remoteAddress?: unknown };
}

export class AuthenticationClientAddressRejectedError extends Error {
  readonly code = 'AUTHENTICATION_CLIENT_ADDRESS_REJECTED' as const;

  constructor() {
    super('Authentication client address rejected');
    this.name = 'AuthenticationClientAddressRejectedError';
  }
}

function reject(): never {
  throw new AuthenticationClientAddressRejectedError();
}

function uniqueForwardedHeader(request: AuthenticationClientAddressRequest): string {
  const headers = request.headers;
  if (!headers || typeof headers !== 'object') return reject();
  const matches = Object.entries(headers).filter(
    ([name]) => name.toLowerCase() === 'x-forwarded-for',
  );
  if (matches.length !== 1 || typeof matches[0]?.[1] !== 'string') return reject();
  const headerValue = matches[0][1];

  const rawHeaders = request.rawHeaders;
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) return reject();
  let rawMatch: string | null = null;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== 'string' || typeof value !== 'string') return reject();
    if (name.toLowerCase() !== 'x-forwarded-for') continue;
    if (rawMatch !== null) return reject();
    rawMatch = value;
  }
  if (rawMatch === null || rawMatch !== headerValue) return reject();
  return headerValue;
}

@Injectable()
export class AuthenticationClientAddressResolver {
  private readonly trustedProxies: BlockList | null;

  constructor(
    @Inject(AUTHENTICATION_CLIENT_ADDRESS_CONFIG)
    private readonly config: AuthenticationClientAddressConfig,
  ) {
    if (config.mode === 'direct') {
      this.trustedProxies = null;
      return;
    }
    const trustedProxies = new BlockList();
    for (const range of config.trustedProxyRanges) {
      trustedProxies.addSubnet(range.address, range.prefixLength, range.family);
    }
    this.trustedProxies = trustedProxies;
  }

  resolve(request: AuthenticationClientAddressRequest): string {
    const peerAddress = canonicalAuthenticationIpAddress(request.socket?.remoteAddress);
    if (peerAddress === null) return reject();
    if (this.config.mode === 'direct') return peerAddress;

    const family = isIP(peerAddress) === 4 ? 'ipv4' : 'ipv6';
    if (!this.trustedProxies?.check(peerAddress, family)) return reject();

    const forwardedAddress = uniqueForwardedHeader(request);
    const canonicalForwardedAddress = canonicalAuthenticationIpAddress(forwardedAddress);
    if (canonicalForwardedAddress === null || canonicalForwardedAddress !== forwardedAddress) {
      return reject();
    }
    return canonicalForwardedAddress;
  }
}
