import type { Metadata } from 'next';

import { AuthenticationShell } from '@/components/authentication/authentication-shell';
import { LoginForm } from '@/components/authentication/login-form';
import { safeAccountReturnPathOrDefault } from '@/lib/authentication';

interface LoginPageProps {
  readonly searchParams?: Promise<{
    readonly error?: string | readonly string[];
    readonly returnTo?: string | readonly string[];
  }>;
}

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Secure account access for the Crypto Lending workspace.',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = searchParams ? await searchParams : {};
  const returnPath = safeAccountReturnPathOrDefault(parameters.returnTo);
  const callbackFailed = parameters.error === 'authentication';

  return (
    <AuthenticationShell
      activePage="login"
      authenticationActionHref={`/register?returnTo=${encodeURIComponent(returnPath)}`}
      eyebrow="Account access"
      title="Welcome back."
      description="Sign in securely to view your portfolio and account."
    >
      <LoginForm key={returnPath} returnPath={returnPath} initialError={callbackFailed} />
    </AuthenticationShell>
  );
}
