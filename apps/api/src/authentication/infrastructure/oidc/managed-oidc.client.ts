import { Buffer } from 'node:buffer';

import type { JSONWebKeySet, JWK, JWTVerifyResult } from 'jose';

import type {
  CreateOidcAuthorizationUrlRequest,
  ExchangeOidcAuthorizationCodeRequest,
  OidcClientPort,
} from '../../application/ports/oidc-client.port';
import {
  parseOidcSubject,
  parseOpaqueAuthenticationSecret,
  parsePkceVerifier,
  type VerifiedOidcIdentity,
} from '../../domain/authentication';
import type { OidcAuthenticationConfig } from '../config/authentication.config';
import {
  constantTimeAuthenticationValueEquals,
  revealSensitiveAuthenticationText,
} from '../crypto/authentication-crypto';
import { loadJoseRuntime } from './jose-runtime';

export type OidcClientErrorCode =
  | 'OIDC_AUTHORIZATION_REQUEST_INVALID'
  | 'OIDC_ID_TOKEN_INVALID'
  | 'OIDC_JWKS_INVALID'
  | 'OIDC_JWKS_UNAVAILABLE'
  | 'OIDC_TOKEN_EXCHANGE_REJECTED'
  | 'OIDC_TOKEN_RESPONSE_INVALID'
  | 'OIDC_TOKEN_SERVICE_UNAVAILABLE';

export class OidcClientError extends Error {
  constructor(readonly code: OidcClientErrorCode) {
    super('OIDC operation failed');
    this.name = 'OidcClientError';
  }
}

export type OidcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface CachedJwks {
  readonly loadedAtEpochMs: number;
  readonly value: JSONWebKeySet;
}

const AUTHORIZATION_CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/u;
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const KEY_ID_PATTERN = /^[\x21-\x7e]{1,128}$/u;
const MAX_ID_TOKEN_BYTES = 32_768;
const MAX_JWKS_KEYS = 32;

function fail(code: OidcClientErrorCode): never {
  throw new OidcClientError(code);
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The generic caller-facing error remains independent of transport details.
  }
}

function formEncodeCredential(value: string): string {
  const encoded = new URLSearchParams([['credential', value]]).toString();
  return encoded.slice('credential='.length);
}

function parseJsonWithoutDuplicateKeys(text: string): unknown {
  let index = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;

  const invalid = (): never => fail('OIDC_TOKEN_RESPONSE_INVALID');
  const whitespace = (): void => {
    while (
      text[index] === ' ' ||
      text[index] === '\t' ||
      text[index] === '\r' ||
      text[index] === '\n'
    ) {
      index += 1;
    }
  };
  const string = (): string => {
    if (text[index] !== '"') return invalid();
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text.charCodeAt(index);
      if (character === 0x22) {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          return invalid();
        }
      }
      if (character < 0x20) return invalid();
      if (character !== 0x5c) {
        index += 1;
        continue;
      }
      index += 1;
      const escaped = text[index];
      if (escaped === 'u') {
        if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) return invalid();
        index += 5;
        continue;
      }
      if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escaped ?? '')) return invalid();
      index += 1;
    }
    return invalid();
  };
  const number = (): void => {
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(text);
    if (!match) return invalid();
    index = numberPattern.lastIndex;
  };
  const value = (depth: number): void => {
    if (depth > 64) return invalid();
    whitespace();
    if (text[index] === '"') {
      string();
      return;
    }
    if (text[index] === '{') {
      object(depth + 1);
      return;
    }
    if (text[index] === '[') {
      list(depth + 1);
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (text.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    number();
  };
  const object = (depth: number): void => {
    index += 1;
    whitespace();
    if (text[index] === '}') {
      index += 1;
      return;
    }
    const keys = new Set<string>();
    while (index < text.length) {
      const key = string();
      if (keys.has(key)) return invalid();
      keys.add(key);
      whitespace();
      if (text[index] !== ':') return invalid();
      index += 1;
      value(depth);
      whitespace();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      if (text[index] !== ',') return invalid();
      index += 1;
      whitespace();
    }
    return invalid();
  };
  const list = (depth: number): void => {
    index += 1;
    whitespace();
    if (text[index] === ']') {
      index += 1;
      return;
    }
    while (index < text.length) {
      value(depth);
      whitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      if (text[index] !== ',') return invalid();
      index += 1;
    }
    return invalid();
  };

  whitespace();
  value(0);
  whitespace();
  if (index !== text.length) return invalid();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return invalid();
  }
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  acceptedContentTypes: readonly string[],
): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const body = response.body;
    if (!body) return fail('OIDC_TOKEN_RESPONSE_INVALID');
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (!contentType || !acceptedContentTypes.includes(contentType)) {
      await cancelResponseBody(response);
      return fail('OIDC_TOKEN_RESPONSE_INVALID');
    }
    reader = body.getReader();
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return fail('OIDC_TOKEN_RESPONSE_INVALID');
      }
      chunks.push(result.value);
    }
    const bytes = Buffer.concat(
      chunks.map((chunk) => Buffer.from(chunk)),
      total,
    );
    return parseJsonWithoutDuplicateKeys(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return fail('OIDC_TOKEN_RESPONSE_INVALID');
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // Cleanup failure never changes the sanitized response error contract.
    }
  }
}

function currentEpochMilliseconds(now: () => Date, code: OidcClientErrorCode): number {
  try {
    const value = now();
    if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) {
      return fail(code);
    }
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) return fail(code);
    return milliseconds;
  } catch {
    return fail(code);
  }
}

function jwksClientFailure(error: unknown): boolean {
  try {
    if (!(error instanceof OidcClientError)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    return (
      descriptor !== undefined &&
      'value' in descriptor &&
      (descriptor.value === 'OIDC_JWKS_INVALID' || descriptor.value === 'OIDC_JWKS_UNAVAILABLE')
    );
  } catch {
    return false;
  }
}

function canonicalBase64UrlBytes(
  value: unknown,
  minimumBytes: number,
  maximumBytes: number,
): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return fail('OIDC_JWKS_INVALID');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (
    bytes.length < minimumBytes ||
    bytes.length > maximumBytes ||
    bytes.toString('base64url') !== value
  ) {
    return fail('OIDC_JWKS_INVALID');
  }
  return bytes;
}

function validateAsymmetricSigningKey(
  key: Record<string, unknown>,
  config: OidcAuthenticationConfig,
): void {
  if (config.signingAlgorithm === 'ES256') {
    if (key.kty !== 'EC' || key.crv !== 'P-256') return fail('OIDC_JWKS_INVALID');
    canonicalBase64UrlBytes(key.x, 32, 32);
    canonicalBase64UrlBytes(key.y, 32, 32);
    return;
  }
  if (key.kty !== 'RSA') return fail('OIDC_JWKS_INVALID');
  const modulus = canonicalBase64UrlBytes(key.n, 256, 1_024);
  const firstByte = modulus[0];
  if (firstByte === undefined || firstByte === 0) return fail('OIDC_JWKS_INVALID');
  const modulusBits = (modulus.length - 1) * 8 + (32 - Math.clz32(firstByte));
  if (modulusBits < 2_048 || modulusBits > 8_192) return fail('OIDC_JWKS_INVALID');
  const exponentBytes = canonicalBase64UrlBytes(key.e, 1, 4);
  if (exponentBytes[0] === 0) return fail('OIDC_JWKS_INVALID');
  let exponent = 0;
  for (const byte of exponentBytes) exponent = exponent * 256 + byte;
  if (!Number.isSafeInteger(exponent) || exponent < 3 || exponent % 2 === 0) {
    return fail('OIDC_JWKS_INVALID');
  }
}

function dataRecord(value: unknown, code: OidcClientErrorCode): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return fail(code);
  return value as Record<string, unknown>;
}

function parseJwks(value: unknown, config: OidcAuthenticationConfig): JSONWebKeySet {
  const record = dataRecord(value, 'OIDC_JWKS_INVALID');
  if (!Array.isArray(record.keys) || record.keys.length < 1 || record.keys.length > MAX_JWKS_KEYS) {
    return fail('OIDC_JWKS_INVALID');
  }
  const seenKids = new Set<string>();
  const keys: JWK[] = [];
  for (const candidate of record.keys) {
    const key = dataRecord(candidate, 'OIDC_JWKS_INVALID');
    const kid = key.kid;
    const kty = key.kty;
    const compatibleKeyType = config.signingAlgorithm === 'ES256' ? kty === 'EC' : kty === 'RSA';
    if (
      !compatibleKeyType ||
      (key.alg !== undefined && key.alg !== config.signingAlgorithm) ||
      (key.use !== undefined && key.use !== 'sig') ||
      (Array.isArray(key.key_ops) && !key.key_ops.includes('verify'))
    ) {
      continue;
    }
    if (
      typeof kid !== 'string' ||
      !KEY_ID_PATTERN.test(kid) ||
      seenKids.has(kid) ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify')) ||
      ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k', 'jku', 'x5u'].some(
        (field) => key[field] !== undefined,
      )
    ) {
      return fail('OIDC_JWKS_INVALID');
    }
    validateAsymmetricSigningKey(key, config);
    seenKids.add(kid);
    const keyOperations = key.key_ops === undefined ? undefined : ([...key.key_ops] as string[]);
    if (keyOperations) Object.freeze(keyOperations);
    const publicKey =
      key.kty === 'RSA'
        ? {
            kty: 'RSA',
            kid,
            alg: config.signingAlgorithm,
            n: key.n as string,
            e: key.e as string,
            ...(key.use === undefined ? {} : { use: key.use as string }),
            ...(keyOperations ? { key_ops: keyOperations } : {}),
          }
        : {
            kty: 'EC',
            kid,
            alg: config.signingAlgorithm,
            crv: key.crv as string,
            x: key.x as string,
            y: key.y as string,
            ...(key.use === undefined ? {} : { use: key.use as string }),
            ...(keyOperations ? { key_ops: keyOperations } : {}),
          };
    keys.push(Object.freeze(publicKey) as JWK);
  }
  if (keys.length < 1) return fail('OIDC_JWKS_INVALID');
  Object.freeze(keys);
  return Object.freeze({ keys });
}

export class PinnedRemoteJwksProvider {
  private cache: CachedJwks | undefined;
  private inFlight: Promise<CachedJwks> | undefined;

  constructor(
    private readonly config: OidcAuthenticationConfig,
    private readonly fetcher: OidcFetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(forceRefresh = false): Promise<JSONWebKeySet> {
    const now = currentEpochMilliseconds(this.now, 'OIDC_JWKS_UNAVAILABLE');
    const cached = this.cache;
    if (
      !forceRefresh &&
      cached &&
      now >= cached.loadedAtEpochMs &&
      now - cached.loadedAtEpochMs < this.config.jwksCacheTtlSeconds * 1_000
    ) {
      return cached.value;
    }
    const existingLoad = this.inFlight;
    if (existingLoad) return (await existingLoad).value;

    const inFlight = this.fetchJwks();
    this.inFlight = inFlight;
    try {
      const loaded = await inFlight;
      this.cache = loaded;
      return loaded.value;
    } finally {
      if (this.inFlight === inFlight) this.inFlight = undefined;
    }
  }

  private async fetchJwks(): Promise<CachedJwks> {
    let response: Response;
    try {
      response = await this.fetcher(this.config.jwksUri, {
        method: 'GET',
        headers: { Accept: 'application/jwk-set+json, application/json' },
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(this.config.httpTimeoutMs),
      });
    } catch {
      return fail('OIDC_JWKS_UNAVAILABLE');
    }
    let status: number;
    try {
      status = response.status;
    } catch {
      return fail('OIDC_JWKS_UNAVAILABLE');
    }
    if (status !== 200) {
      await cancelResponseBody(response);
      return fail('OIDC_JWKS_UNAVAILABLE');
    }
    let value: unknown;
    try {
      value = await readBoundedJson(response, this.config.jwksResponseMaxBytes, [
        'application/json',
        'application/jwk-set+json',
      ]);
    } catch {
      return fail('OIDC_JWKS_INVALID');
    }
    let parsed: JSONWebKeySet;
    try {
      parsed = parseJwks(value, this.config);
    } catch {
      return fail('OIDC_JWKS_INVALID');
    }
    return Object.freeze({
      loadedAtEpochMs: currentEpochMilliseconds(this.now, 'OIDC_JWKS_UNAVAILABLE'),
      value: parsed,
    });
  }
}

export interface OidcJwksProvider {
  load(forceRefresh?: boolean): Promise<JSONWebKeySet>;
}

export class ManagedOidcClient implements OidcClientPort {
  private readonly jwks: OidcJwksProvider;

  constructor(
    private readonly config: OidcAuthenticationConfig,
    private readonly fetcher: OidcFetch = fetch,
    jwks?: OidcJwksProvider,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.jwks = jwks ?? new PinnedRemoteJwksProvider(config, fetcher, now);
  }

  createAuthorizationUrl(request: CreateOidcAuthorizationUrlRequest): URL {
    try {
      const state = parseOpaqueAuthenticationSecret<'oidc-state'>(request.state);
      const nonce = parseOpaqueAuthenticationSecret<'oidc-nonce'>(request.nonce);
      if (!CODE_CHALLENGE_PATTERN.test(request.codeChallenge)) {
        return fail('OIDC_AUTHORIZATION_REQUEST_INVALID');
      }
      const url = new URL(this.config.authorizationEndpoint);
      if ([...url.searchParams].length > 0 || url.hash !== '') {
        return fail('OIDC_AUTHORIZATION_REQUEST_INVALID');
      }
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', this.config.clientId);
      url.searchParams.set('redirect_uri', this.config.redirectUri);
      url.searchParams.set('scope', 'openid');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', request.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      return url;
    } catch {
      return fail('OIDC_AUTHORIZATION_REQUEST_INVALID');
    }
  }

  async exchangeAuthorizationCode(
    request: ExchangeOidcAuthorizationCodeRequest,
  ): Promise<VerifiedOidcIdentity> {
    let code: string;
    let codeVerifier: string;
    let expectedNonce: string;
    try {
      if (typeof request.code !== 'string' || !AUTHORIZATION_CODE_PATTERN.test(request.code)) {
        return fail('OIDC_TOKEN_RESPONSE_INVALID');
      }
      code = request.code;
      codeVerifier = parsePkceVerifier(request.codeVerifier);
      expectedNonce = parseOpaqueAuthenticationSecret<'oidc-nonce'>(request.expectedNonce);
    } catch {
      return fail('OIDC_TOKEN_RESPONSE_INVALID');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: codeVerifier,
    });
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.config.tokenEndpointAuthenticationMethod === 'client_secret_basic') {
      const secret = this.config.clientSecret;
      if (!secret) return fail('OIDC_TOKEN_SERVICE_UNAVAILABLE');
      const credential = `${formEncodeCredential(this.config.clientId)}:${formEncodeCredential(
        revealSensitiveAuthenticationText(secret),
      )}`;
      headers.Authorization = `Basic ${Buffer.from(credential, 'utf8').toString('base64')}`;
    } else {
      body.set('client_id', this.config.clientId);
    }

    let response: Response;
    try {
      response = await this.fetcher(this.config.tokenEndpoint, {
        method: 'POST',
        headers,
        body: body.toString(),
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(this.config.httpTimeoutMs),
      });
    } catch {
      return fail('OIDC_TOKEN_SERVICE_UNAVAILABLE');
    }
    let status: number;
    try {
      status = response.status;
    } catch {
      return fail('OIDC_TOKEN_RESPONSE_INVALID');
    }
    if (status !== 200) {
      await cancelResponseBody(response);
      return fail(
        status === 400 ? 'OIDC_TOKEN_EXCHANGE_REJECTED' : 'OIDC_TOKEN_SERVICE_UNAVAILABLE',
      );
    }
    let tokenResponse: Record<string, unknown>;
    try {
      tokenResponse = dataRecord(
        await readBoundedJson(response, this.config.tokenResponseMaxBytes, ['application/json']),
        'OIDC_TOKEN_RESPONSE_INVALID',
      );
    } catch {
      return fail('OIDC_TOKEN_RESPONSE_INVALID');
    }
    const idToken = tokenResponse.id_token;
    if (
      typeof idToken !== 'string' ||
      Buffer.byteLength(idToken, 'utf8') > MAX_ID_TOKEN_BYTES ||
      !COMPACT_JWT_PATTERN.test(idToken)
    ) {
      return fail('OIDC_TOKEN_RESPONSE_INVALID');
    }
    return this.verifyIdToken(idToken, expectedNonce);
  }

  private async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<VerifiedOidcIdentity> {
    const jose = await loadJoseRuntime();
    let header: ReturnType<typeof jose.decodeProtectedHeader>;
    try {
      header = jose.decodeProtectedHeader(idToken);
    } catch {
      return fail('OIDC_ID_TOKEN_INVALID');
    }
    if (
      header.alg !== this.config.signingAlgorithm ||
      typeof header.kid !== 'string' ||
      !KEY_ID_PATTERN.test(header.kid) ||
      (header.typ !== undefined && header.typ !== 'JWT') ||
      header.crit !== undefined ||
      header.jku !== undefined ||
      header.x5u !== undefined ||
      header.jwk !== undefined ||
      header.x5c !== undefined
    ) {
      return fail('OIDC_ID_TOKEN_INVALID');
    }

    const verify = async (forceRefresh: boolean): Promise<JWTVerifyResult> => {
      let jwks: JSONWebKeySet;
      try {
        jwks = await this.jwks.load(forceRefresh);
      } catch {
        return fail('OIDC_JWKS_UNAVAILABLE');
      }
      return jose.jwtVerify(idToken, jose.createLocalJWKSet(jwks), {
        algorithms: [this.config.signingAlgorithm],
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: this.config.clockToleranceSeconds,
        currentDate: this.now(),
        requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'],
      });
    };

    let verified: Awaited<ReturnType<typeof verify>>;
    try {
      verified = await verify(false);
    } catch (error) {
      if (jwksClientFailure(error)) {
        return fail('OIDC_JWKS_UNAVAILABLE');
      }
      const noMatchingKey = (() => {
        try {
          return error instanceof jose.errors.JWKSNoMatchingKey;
        } catch {
          return false;
        }
      })();
      if (noMatchingKey) {
        try {
          verified = await verify(true);
        } catch (refreshError) {
          if (jwksClientFailure(refreshError)) {
            return fail('OIDC_JWKS_UNAVAILABLE');
          }
          return fail('OIDC_ID_TOKEN_INVALID');
        }
      } else {
        return fail('OIDC_ID_TOKEN_INVALID');
      }
    }

    const payload = verified.payload;
    const nowEpochSeconds = Math.floor(
      currentEpochMilliseconds(this.now, 'OIDC_ID_TOKEN_INVALID') / 1_000,
    );
    const issuedAt = payload.iat;
    const expiresAt = payload.exp;
    const notBefore = payload.nbf;
    const authorizedParty = payload.azp;
    const audience = payload.aud;
    const tokenUse = payload.token_use;
    if (
      !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) ||
      (notBefore !== undefined && !Number.isSafeInteger(notBefore)) ||
      (issuedAt as number) > nowEpochSeconds + this.config.clockToleranceSeconds ||
      nowEpochSeconds - (issuedAt as number) >
        this.config.maximumIdTokenAgeSeconds + this.config.clockToleranceSeconds ||
      (expiresAt as number) <= (issuedAt as number) ||
      (notBefore !== undefined && (notBefore as number) >= (expiresAt as number)) ||
      !(
        (typeof audience === 'string' && audience === this.config.audience) ||
        (Array.isArray(audience) &&
          audience.length > 0 &&
          audience.length <= 8 &&
          audience.every(
            (entry) =>
              typeof entry === 'string' &&
              entry.length > 0 &&
              entry.length <= 256 &&
              /^[\x21-\x7e]+$/u.test(entry),
          ) &&
          new Set(audience).size === audience.length &&
          audience.includes(this.config.audience))
      ) ||
      typeof payload.nonce !== 'string' ||
      !constantTimeAuthenticationValueEquals(payload.nonce, expectedNonce) ||
      (this.config.requiredTokenUse !== undefined && tokenUse !== this.config.requiredTokenUse) ||
      (authorizedParty !== undefined && authorizedParty !== this.config.clientId) ||
      (Array.isArray(audience) && audience.length > 1 && authorizedParty !== this.config.clientId)
    ) {
      return fail('OIDC_ID_TOKEN_INVALID');
    }
    let subject: ReturnType<typeof parseOidcSubject>;
    try {
      subject = parseOidcSubject(payload.sub);
    } catch {
      return fail('OIDC_ID_TOKEN_INVALID');
    }
    return Object.freeze({
      providerKey: this.config.providerKey,
      issuer: this.config.issuer,
      subject,
      issuedAtEpochSeconds: issuedAt as number,
      expiresAtEpochSeconds: expiresAt as number,
    });
  }
}
