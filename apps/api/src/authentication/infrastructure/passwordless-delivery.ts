import { Injectable } from '@nestjs/common';

import {
  checkSmsVerification,
  sendSmsVerification,
  twilioVerifyAvailable,
  type SmsVerification,
  type SmsVerificationCheck,
} from './twilio-verify';

export type PasswordlessChannel = 'email' | 'sms';

export type PasswordlessMessage = {
  readonly id: string;
  readonly destination: string;
} & ({ readonly channel: 'email'; readonly code: string } | { readonly channel: 'sms' });

export class PasswordlessDeliveryUnavailable extends Error {
  constructor() {
    super('Sign-in code delivery is unavailable');
  }
}

/** Provider credentials and responses never enter logs or browser responses. */
@Injectable()
export class PasswordlessDelivery {
  available(channel: PasswordlessChannel): boolean {
    return channel === 'email'
      ? Boolean(process.env.RESEND_API_KEY?.trim() && process.env.AUTH_EMAIL_FROM?.trim())
      : twilioVerifyAvailable();
  }

  async send(message: PasswordlessMessage): Promise<SmsVerification | null> {
    if (!this.available(message.channel)) throw new PasswordlessDeliveryUnavailable();
    try {
      if (message.channel === 'sms') return await sendSmsVerification(message.destination);
      const text = `Your Bonsai sign-in code is ${message.code}. It expires in 10 minutes. If you did not request this code, ignore this message.`;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `bonsai-login-${message.id}`,
        },
        body: JSON.stringify({
          from: process.env.AUTH_EMAIL_FROM,
          to: [message.destination],
          subject: 'Your Bonsai sign-in code',
          text,
        }),
      });
      // Do not retain provider bodies, which can contain codes or recipient data.
      await response.body?.cancel();
      if (!response.ok) throw new PasswordlessDeliveryUnavailable();
      return null;
    } catch {
      throw new PasswordlessDeliveryUnavailable();
    }
  }

  async verifySms(check: SmsVerificationCheck): Promise<boolean> {
    try {
      return await checkSmsVerification(check);
    } catch {
      throw new PasswordlessDeliveryUnavailable();
    }
  }
}
