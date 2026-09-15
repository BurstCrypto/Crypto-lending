import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ assignBrowserLocation: vi.fn() }));
vi.mock('@/components/authentication/browser-navigation', () => navigation);
import { PasswordlessForm } from '../components/authentication/passwordless-form';
import LoginPage from '../app/login/page';
import RegisterPage from '../app/register/page';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('passwordless sign-in screen', () => {
  it('asks for a code, verifies it, and opens the local account with no provider redirect', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ mode: 'passwordless', email: true, sms: true }))
      .mockResolvedValueOnce(json({ status: 'sent', channel: 'email', expiresInSeconds: 600 }))
      .mockResolvedValueOnce(json({ status: 'authenticated' }));
    render(<PasswordlessForm returnPath="/account" />);
    await screen.findByLabelText('Email or phone number');
    fireEvent.change(screen.getByLabelText('Email or phone number'), {
      target: { value: 'person@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    const code = await screen.findByLabelText('Sign-in code');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(navigation.assignBrowserLocation).toHaveBeenCalledWith('/account'));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/auth/options',
      '/api/v1/auth/code/request',
      '/api/v1/auth/code/verify',
    ]);
    expect(fetch.mock.calls[2]![1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ code: '123456' }),
    });
  });

  it('collects profile details after a new email has been verified', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ mode: 'passwordless', email: true, sms: false }))
      .mockResolvedValueOnce(json({ status: 'sent' }))
      .mockResolvedValueOnce(
        json({ status: 'profile_required', channel: 'email', contactEmail: 'person@example.test' }),
      )
      .mockResolvedValueOnce(json({ status: 'authenticated' }));
    render(<PasswordlessForm returnPath="https://untrusted.example" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send sign-in code' })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    fireEvent.change(await screen.findByLabelText('Sign-in code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByLabelText('Contact email')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Country of residence'), { target: { value: 'US' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(navigation.assignBrowserLocation).toHaveBeenCalledWith('/account'));
  });

  it('supports a U.S. phone-only service and collects a new phone user profile after verification', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ mode: 'passwordless', email: false, sms: true }))
      .mockResolvedValueOnce(json({ status: 'sent', channel: 'sms' }))
      .mockResolvedValueOnce(json({ status: 'profile_required', channel: 'sms' }))
      .mockResolvedValueOnce(json({ status: 'authenticated' }));
    render(<PasswordlessForm returnPath="/account" />);
    const phone = await screen.findByLabelText('Phone number');
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('placeholder', '(202) 555-0123');
    expect(screen.getByText(/U.S. phone numbers only/)).toBeInTheDocument();
    fireEvent.change(phone, { target: { value: '(202) 555-0123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    fireEvent.change(await screen.findByLabelText('Sign-in code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    const email = await screen.findByLabelText('Contact email');
    expect(email).not.toHaveAttribute('readonly');
    expect(email).toHaveValue('');
    fireEvent.change(email, { target: { value: 'phone-contact@example.test' } });
    fireEvent.change(screen.getByLabelText('Country of residence'), { target: { value: 'US' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(navigation.assignBrowserLocation).toHaveBeenCalledWith('/account'));
    expect(fetch.mock.calls[1]![1]?.body).toBe(JSON.stringify({ identifier: '(202) 555-0123' }));
    expect(fetch.mock.calls[3]![1]?.body).toBe(
      JSON.stringify({
        contactEmail: 'phone-contact@example.test',
        declaredResidencyCountryCode: 'US',
      }),
    );
  });

  it('explains the U.S. restriction when a phone number is rejected', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ mode: 'passwordless', email: false, sms: true }))
      .mockResolvedValueOnce(json({}, 401));
    render(<PasswordlessForm returnPath="/account" />);
    fireEvent.change(await screen.findByLabelText('Phone number'), {
      target: { value: '+14165550123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid U.S. phone number.');
    expect(screen.queryByLabelText('Sign-in code')).toBeNull();
  });

  it('shows failed code delivery without advancing or claiming a message was sent', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ mode: 'passwordless', email: true, sms: false }))
      .mockResolvedValueOnce(json({}, 503));
    render(<PasswordlessForm returnPath="/account" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send sign-in code' })).toBeEnabled(),
    );
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
    expect(screen.queryByLabelText('Sign-in code')).toBeNull();
    expect(navigation.assignBrowserLocation).not.toHaveBeenCalled();
  });

  it('disables sending when neither channel is configured', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ mode: 'passwordless', email: false, sms: false }),
    );
    render(<PasswordlessForm returnPath="/account" />);
    await screen.findByRole('status');
    expect(screen.getByRole('button', { name: 'Send sign-in code' })).toBeDisabled();
  });

  it.each([LoginPage, RegisterPage])(
    'uses the code flow on the configured access page',
    async (Page) => {
      vi.stubEnv('AUTH_MODE', 'passwordless');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        json({ mode: 'passwordless', email: true, sms: true }),
      );
      render(await Page({}));
      await screen.findByLabelText('Email or phone number');
      expect(screen.queryByText('Continue to sign in')).toBeNull();
      expect(screen.getByRole('button', { name: 'Send sign-in code' })).toBeEnabled();
    },
  );
});
