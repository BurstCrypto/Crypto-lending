import {
  createHash,
  createHmac,
  createPrivateKey,
  timingSafeEqual,
  X509Certificate,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { WALLET_LAB_HOST, WALLET_LAB_ORIGIN, WALLET_LAB_PORT } from '../src/local-boundary.ts';

const ACCESS_COOKIE_NAME = '__Host-wallet_lab_access';
const CERTIFICATE_MAX_BYTES = 256 * 1024;
const PRIVATE_KEY_MAX_BYTES = 64 * 1024;

export const WALLET_LAB_AUTHORITY = `${WALLET_LAB_HOST}:${WALLET_LAB_PORT}` as const;

export type WalletLabSecureAccessEnvironment = Readonly<{
  WALLET_LAB_ACCESS_PASSWORD?: string | undefined;
  WALLET_LAB_ACCESS_USERNAME?: string | undefined;
  WALLET_LAB_HTTPS_CERT_PATH?: string | undefined;
  WALLET_LAB_HTTPS_KEY_PATH?: string | undefined;
}>;

export type WalletLabAccessDecision =
  | Readonly<{ allowed: true; via: 'basic' | 'cookie' }>
  | Readonly<{
      allowed: false;
      reason: 'access-credentials-required' | 'invalid-host' | 'invalid-origin';
    }>;

export type WalletLabRequestHeaders = Readonly<{
  authorization?: string | readonly string[] | undefined;
  cookie?: string | readonly string[] | undefined;
  host?: string | readonly string[] | undefined;
  origin?: string | readonly string[] | undefined;
}>;

export type WalletLabAccessVerifier = Readonly<{
  authorize(
    headers: WalletLabRequestHeaders,
    transport: 'http' | 'websocket',
  ): WalletLabAccessDecision;
  readonly sessionCookie: string;
}>;

export type ResolvedWalletLabSecureAccess = Readonly<{
  access: WalletLabAccessVerifier;
  https: Readonly<{
    cert: Buffer;
    key: Buffer;
    minVersion: 'TLSv1.2';
  }>;
}>;

export type WalletLabSecureAccessDependencies = Readonly<{
  now?: Date | undefined;
  readFile?: ((path: string) => Buffer) | undefined;
  validateTlsMaterial?: ((certificate: Buffer, privateKey: Buffer, now: Date) => void) | undefined;
}>;

function requiredValue(
  environment: WalletLabSecureAccessEnvironment,
  name: keyof WalletLabSecureAccessEnvironment,
): string {
  const value = environment[name];

  if (!value) throw new Error(`${name} is required for the wallet lab.`);

  return value;
}

function readTlsFile(
  path: string,
  label: 'certificate' | 'private key',
  readFile: (path: string) => Buffer,
): Buffer {
  if (!isAbsolute(path)) {
    throw new Error(`Wallet lab HTTPS ${label} path must be absolute.`);
  }

  try {
    return readFile(path);
  } catch {
    throw new Error(`Wallet lab HTTPS ${label} could not be read.`);
  }
}

function assertBoundedTlsMaterial(value: Buffer, label: string, maximumBytes: number): void {
  if (value.byteLength === 0 || value.byteLength > maximumBytes) {
    throw new Error(`Wallet lab HTTPS ${label} has an invalid size.`);
  }
}

export function assertWalletLabTlsMaterial(
  certificateBytes: Buffer,
  privateKeyBytes: Buffer,
  now = new Date(),
): void {
  let certificate: X509Certificate;

  try {
    certificate = new X509Certificate(certificateBytes);
  } catch {
    throw new Error('Wallet lab HTTPS certificate is not valid PEM X.509 material.');
  }

  let privateKey: ReturnType<typeof createPrivateKey>;

  try {
    privateKey = createPrivateKey(privateKeyBytes);
  } catch {
    throw new Error('Wallet lab HTTPS private key is not valid unencrypted PEM material.');
  }

  if (certificate.checkIP(WALLET_LAB_HOST) !== WALLET_LAB_HOST) {
    throw new Error(`Wallet lab HTTPS certificate must contain an IP SAN for ${WALLET_LAB_HOST}.`);
  }

  if (
    now.getTime() < certificate.validFromDate.getTime() ||
    now.getTime() > certificate.validToDate.getTime()
  ) {
    throw new Error('Wallet lab HTTPS certificate is not currently valid.');
  }

  if (!certificate.checkPrivateKey(privateKey)) {
    throw new Error('Wallet lab HTTPS certificate and private key do not match.');
  }
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function securelyEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();

  return timingSafeEqual(leftDigest, rightDigest);
}

function parseBasicAuthorization(value: string | undefined):
  | Readonly<{
      password: string;
      username: string;
    }>
  | undefined {
  if (!value || value.length > 512) return undefined;

  const match = /^Basic ([A-Za-z\d+/]+={0,2})$/iu.exec(value);
  if (!match) return undefined;

  const encoded = match[1];
  if (!encoded) return undefined;

  const decodedBytes = Buffer.from(encoded, 'base64');
  const canonical = decodedBytes.toString('base64').replace(/=+$/u, '');

  if (canonical !== encoded.replace(/=+$/u, '')) return undefined;

  const decoded = decodedBytes.toString('utf8');
  if (!/^[\x21-\x7e]+$/u.test(decoded)) return undefined;

  const separator = decoded.indexOf(':');
  if (separator <= 0) return undefined;

  return Object.freeze({
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  });
}

function hasSessionCookie(value: string | undefined, expectedToken: string): boolean {
  if (!value || value.length > 4096) return false;

  for (const pair of value.split(';')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;

    const name = pair.slice(0, separator).trim();
    const token = pair.slice(separator + 1).trim();

    if (name === ACCESS_COOKIE_NAME && securelyEqual(token, expectedToken)) return true;
  }

  return false;
}

function createAccessVerifier(
  username: string,
  password: string,
  certificate: Buffer,
): WalletLabAccessVerifier {
  const certificateDigest = createHash('sha256').update(certificate).digest('hex');
  const sessionToken = createHmac('sha256', password)
    .update(`wallet-lab-access-v1\0${username}\0${certificateDigest}`, 'utf8')
    .digest('base64url');
  const sessionCookie = `${ACCESS_COOKIE_NAME}=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Strict`;

  return Object.freeze({
    sessionCookie,
    authorize(
      headers: WalletLabRequestHeaders,
      transport: 'http' | 'websocket',
    ): WalletLabAccessDecision {
      if (singleHeader(headers.host) !== WALLET_LAB_AUTHORITY) {
        return Object.freeze({ allowed: false, reason: 'invalid-host' });
      }

      if (transport === 'websocket' && singleHeader(headers.origin) !== WALLET_LAB_ORIGIN) {
        return Object.freeze({ allowed: false, reason: 'invalid-origin' });
      }

      const basic = parseBasicAuthorization(singleHeader(headers.authorization));
      if (
        basic &&
        securelyEqual(basic.username, username) &&
        securelyEqual(basic.password, password)
      ) {
        return Object.freeze({ allowed: true, via: 'basic' });
      }

      if (hasSessionCookie(singleHeader(headers.cookie), sessionToken)) {
        return Object.freeze({ allowed: true, via: 'cookie' });
      }

      return Object.freeze({ allowed: false, reason: 'access-credentials-required' });
    },
  });
}

export function resolveWalletLabSecureAccess(
  environment: WalletLabSecureAccessEnvironment,
  dependencies: WalletLabSecureAccessDependencies = {},
): ResolvedWalletLabSecureAccess {
  const certificatePath = requiredValue(environment, 'WALLET_LAB_HTTPS_CERT_PATH').trim();
  const privateKeyPath = requiredValue(environment, 'WALLET_LAB_HTTPS_KEY_PATH').trim();
  const username = requiredValue(environment, 'WALLET_LAB_ACCESS_USERNAME').trim();
  const password = requiredValue(environment, 'WALLET_LAB_ACCESS_PASSWORD');

  if (certificatePath === privateKeyPath) {
    throw new Error('Wallet lab HTTPS certificate and private key paths must be different.');
  }

  if (!/^[A-Za-z\d._~-]{3,64}$/u.test(username)) {
    throw new Error('WALLET_LAB_ACCESS_USERNAME must be 3-64 restricted ASCII characters.');
  }

  if (password.length < 24 || password.length > 128 || !/^[\x21-\x7e]+$/u.test(password)) {
    throw new Error(
      'WALLET_LAB_ACCESS_PASSWORD must be 24-128 non-whitespace printable ASCII characters.',
    );
  }

  const readFile = dependencies.readFile ?? readFileSync;
  const certificate = readTlsFile(certificatePath, 'certificate', readFile);
  const privateKey = readTlsFile(privateKeyPath, 'private key', readFile);

  assertBoundedTlsMaterial(certificate, 'certificate', CERTIFICATE_MAX_BYTES);
  assertBoundedTlsMaterial(privateKey, 'private key', PRIVATE_KEY_MAX_BYTES);

  const validateTlsMaterial = dependencies.validateTlsMaterial ?? assertWalletLabTlsMaterial;
  validateTlsMaterial(certificate, privateKey, dependencies.now ?? new Date());

  return Object.freeze({
    access: createAccessVerifier(username, password, certificate),
    https: Object.freeze({
      cert: certificate,
      key: privateKey,
      minVersion: 'TLSv1.2',
    }),
  });
}
