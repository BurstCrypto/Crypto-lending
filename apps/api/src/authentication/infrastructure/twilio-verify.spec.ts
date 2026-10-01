import { PasswordlessDelivery, PasswordlessDeliveryUnavailable } from './passwordless-delivery';

describe('Twilio Verify SMS delivery', () => {
  const accountSid = `AC${'a'.repeat(32)}`;
  const serviceSid = `VA${'b'.repeat(32)}`;
  const verificationSid = `VE${'c'.repeat(32)}`;
  const destination = '+12025550123';
  const check = { verificationSid, destination, code: '123456' };
  const delivery = new PasswordlessDelivery();
  const variables = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID'];
  let original: NodeJS.ProcessEnv;

  function response(overrides: Record<string, unknown> = {}, status = 200): Response {
    return Response.json(
      {
        sid: verificationSid,
        service_sid: serviceSid,
        account_sid: accountSid,
        to: destination,
        channel: 'sms',
        status: 'pending',
        valid: false,
        ...overrides,
      },
      { status },
    );
  }

  beforeEach(() => {
    original = { ...process.env };
    process.env.TWILIO_ACCOUNT_SID = accountSid;
    process.env.TWILIO_AUTH_TOKEN = 'test-verify-token';
    process.env.TWILIO_VERIFY_SERVICE_SID = serviceSid;
  });

  afterEach(() => {
    for (const name of variables) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    jest.restoreAllMocks();
  });

  it('asks Verify to generate and send the code using its fixed service endpoint', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 201));
    expect(delivery.available('sms')).toBe(true);
    await expect(delivery.send({ id: 'challenge', channel: 'sms', destination })).resolves.toEqual({
      verificationSid,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`);
    expect(Object.fromEntries(new URLSearchParams(init!.body as string))).toEqual({
      To: destination,
      Channel: 'sms',
    });
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:test-verify-token`).toString('base64')}`,
      },
    });
  });

  it('checks the stored verification ID and accepts only its matching approval', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ status: 'approved', valid: true }));
    await expect(delivery.verifySms(check)).resolves.toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`);
    expect(Object.fromEntries(new URLSearchParams(init!.body as string))).toEqual({
      VerificationSid: verificationSid,
      Code: '123456',
    });
    expect(init?.redirect).toBe('error');
  });

  it('rejects incorrect codes and expired or consumed provider verifications', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(new Response('private-provider-response', { status: 404 }));
    await expect(delivery.verifySms(check)).resolves.toBe(false);
    await expect(delivery.verifySms(check)).resolves.toBe(false);
  });

  it.each([
    { sid: `VE${'d'.repeat(32)}` },
    { sid: 'not-a-verification' },
    { to: '+12025550124' },
    { account_sid: `AC${'d'.repeat(32)}` },
    { service_sid: `VA${'d'.repeat(32)}` },
    { channel: 'email' },
    { status: 'pending' },
    { valid: false },
  ])('does not trust a mismatched or inconsistent approval: %j', async (overrides) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ status: 'approved', valid: true, ...overrides }));
    await expect(delivery.verifySms(check)).rejects.toBeInstanceOf(PasswordlessDeliveryUnavailable);
  });

  it.each([401, 429, 500, 503])('hides provider details on HTTP %i', async (status) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('private-provider-response', { status }));
    await expect(delivery.verifySms(check)).rejects.toThrow('Sign-in code delivery is unavailable');
    await expect(delivery.send({ id: 'challenge', channel: 'sms', destination })).rejects.toThrow(
      'Sign-in code delivery is unavailable',
    );
  });

  it.each([
    ['TWILIO_ACCOUNT_SID', 'AC../../untrusted'],
    ['TWILIO_VERIFY_SERVICE_SID', `MG${'b'.repeat(32)}`],
    ['TWILIO_AUTH_TOKEN', '   '],
  ])('rejects invalid %s before making requests', async (name, value) => {
    process.env[name] = value;
    const fetch = jest.spyOn(globalThis, 'fetch');
    expect(delivery.available('sms')).toBe(false);
    await expect(
      delivery.send({ id: 'challenge', channel: 'sms', destination }),
    ).rejects.toBeInstanceOf(PasswordlessDeliveryUnavailable);
    await expect(delivery.verifySms(check)).rejects.toBeInstanceOf(PasswordlessDeliveryUnavailable);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects non-U.S. destinations and malformed checks before contacting Twilio', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    await expect(
      delivery.send({ id: 'challenge', channel: 'sms', destination: '+14165550123' }),
    ).rejects.toBeInstanceOf(PasswordlessDeliveryUnavailable);
    await expect(
      delivery.verifySms({ ...check, verificationSid: 'VE../invalid' }),
    ).rejects.toBeInstanceOf(PasswordlessDeliveryUnavailable);
    await expect(delivery.verifySms({ ...check, code: '12345' })).rejects.toBeInstanceOf(
      PasswordlessDeliveryUnavailable,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on unreadable, oversized or malformed responses and network failures', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('not-json', { headers: { 'Content-Type': 'application/json' } }),
      )
      .mockResolvedValueOnce(Response.json({ private: 'x'.repeat(16_384) }))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(Response.json(null))
      .mockRejectedValueOnce(new Error('private-network-error'));
    for (let i = 0; i < 5; i++) {
      await expect(delivery.verifySms(check)).rejects.toThrow(
        'Sign-in code delivery is unavailable',
      );
    }
  });

  it('does not mark a send successful without a pending SMS verification', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ status: 'approved', valid: true }));
    await expect(
      delivery.send({ id: 'challenge', channel: 'sms', destination }),
    ).rejects.toBeInstanceOf(PasswordlessDeliveryUnavailable);
  });
});
