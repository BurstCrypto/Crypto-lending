import { normalizePasswordlessPhone } from '../domain/passwordless-phone';

export interface SmsVerification {
  readonly verificationSid: string;
}

export interface SmsVerificationCheck extends SmsVerification {
  readonly destination: string;
  readonly code: string;
}

interface VerifyConfig {
  accountSid: string;
  serviceSid: string;
  authToken: string;
}

function verifyConfig(): VerifyConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim() ?? '';
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? '';
  if (
    !/^AC[0-9a-fA-F]{32}$/u.test(accountSid) ||
    !/^VA[0-9a-fA-F]{32}$/u.test(serviceSid) ||
    !authToken
  )
    return null;
  return { accountSid, serviceSid, authToken };
}

export function twilioVerifyAvailable(): boolean {
  return verifyConfig() !== null;
}

export function isSmsVerificationSid(value: unknown): value is string {
  return typeof value === 'string' && /^VE[0-9a-fA-F]{32}$/u.test(value);
}

function unavailable(): Error {
  return new Error('SMS verification is unavailable');
}

/** Bound the response before parsing; never include provider payloads in errors. */
async function readVerifyResponse(response: Response): Promise<unknown> {
  if (!/^application\/json(?:;|$)/iu.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel();
    throw unavailable();
  }
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw unavailable();
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function verifyRequest(
  config: VerifyConfig,
  resource: 'Verifications' | 'VerificationCheck',
  parameters: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${config.serviceSid}/${resource}`,
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(parameters).toString(),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    // Verify removes expired, consumed and exhausted verifications.
    if (resource === 'VerificationCheck' && response.status === 404) return undefined;
    throw unavailable();
  }
  return readVerifyResponse(response);
}

function verificationResponse(
  value: unknown,
  config: VerifyConfig,
  destination: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const result = value as Record<string, unknown>;
  if (
    !isSmsVerificationSid(result.sid) ||
    result.account_sid !== config.accountSid ||
    result.service_sid !== config.serviceSid ||
    result.to !== destination ||
    result.channel !== 'sms'
  )
    throw unavailable();
  return result;
}

export async function sendSmsVerification(destination: string): Promise<SmsVerification> {
  try {
    const config = verifyConfig();
    if (!config || normalizePasswordlessPhone(destination) !== destination) throw unavailable();
    const result = verificationResponse(
      await verifyRequest(config, 'Verifications', { To: destination, Channel: 'sms' }),
      config,
      destination,
    );
    if (result.status !== 'pending' || result.valid !== false) throw unavailable();
    return { verificationSid: result.sid as string };
  } catch {
    throw unavailable();
  }
}

export async function checkSmsVerification(check: SmsVerificationCheck): Promise<boolean> {
  try {
    const config = verifyConfig();
    if (
      !config ||
      !isSmsVerificationSid(check.verificationSid) ||
      normalizePasswordlessPhone(check.destination) !== check.destination ||
      !/^\d{6}$/u.test(check.code)
    )
      throw unavailable();
    const response = await verifyRequest(config, 'VerificationCheck', {
      VerificationSid: check.verificationSid,
      Code: check.code,
    });
    if (response === undefined) return false;
    const result = verificationResponse(response, config, check.destination);
    if (result.sid !== check.verificationSid) throw unavailable();
    if (result.status === 'approved' && result.valid === true) return true;
    if (result.status === 'pending' && result.valid === false) return false;
    throw unavailable();
  } catch {
    throw unavailable();
  }
}
