import { PasswordlessDelivery, PasswordlessDeliveryUnavailable } from './passwordless-delivery';

describe('passwordless delivery', () => {
  const names = [
    'RESEND_API_KEY',
    'AUTH_EMAIL_FROM',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_MESSAGING_SERVICE_SID',
    'TWILIO_VERIFY_SERVICE_SID',
  ];
  let original: NodeJS.ProcessEnv;
  const message = {
    id: 'test-delivery-id',
    destination: 'person@example.test',
    code: '123456',
    channel: 'email' as const,
  };

  beforeEach(() => {
    original = { ...process.env };
    for (const name of names) delete process.env[name];
  });
  afterEach(() => {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
    jest.restoreAllMocks();
  });

  it('does not send or claim availability without provider credentials', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const delivery = new PasswordlessDelivery();
    expect(delivery.available('email')).toBe(false);
    expect(delivery.available('sms')).toBe(false);
    await expect(delivery.send(message)).rejects.toBeInstanceOf(PasswordlessDeliveryUnavailable);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends email to the fixed Resend endpoint with an idempotency key', async () => {
    process.env.RESEND_API_KEY = 'test-resend-credential';
    process.env.AUTH_EMAIL_FROM = 'Bonsai <login@example.test>';
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    await new PasswordlessDelivery().send(message);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ 'Idempotency-Key': 'bonsai-login-test-delivery-id' }),
      }),
    );
    const payload = JSON.parse(fetch.mock.calls[0]![1]!.body as string) as {
      to: string[];
      text: string;
    };
    expect(payload.to).toEqual([message.destination]);
    expect(payload.text).toContain(message.code);
  });

  it('does not enable Verify with legacy Messaging Service credentials', () => {
    process.env.TWILIO_ACCOUNT_SID = `AC${'a'.repeat(32)}`;
    process.env.TWILIO_MESSAGING_SERVICE_SID = `MG${'b'.repeat(32)}`;
    process.env.TWILIO_AUTH_TOKEN = 'test-twilio-credential';
    expect(new PasswordlessDelivery().available('sms')).toBe(false);
  });

  it('replaces provider failures with a generic error without logging the response', async () => {
    process.env.RESEND_API_KEY = 'test-resend-credential';
    process.env.AUTH_EMAIL_FROM = 'login@example.test';
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('private-provider-response', { status: 429 }));
    await expect(new PasswordlessDelivery().send(message)).rejects.toThrow(
      'Sign-in code delivery is unavailable',
    );
  });
});
