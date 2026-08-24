import Link from 'next/link';

import { AuthenticationShell } from '@/components/authentication/authentication-shell';
import { LoginForm } from '@/components/authentication/login-form';
import { safeAccountReturnPathOrDefault } from '@/lib/authentication';

interface LoginPageProps {
  readonly searchParams?: Promise<{
    readonly error?: string | readonly string[];
    readonly returnTo?: string | readonly string[];
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = searchParams ? await searchParams : {};
  const returnPath = safeAccountReturnPathOrDefault(parameters.returnTo);
  const callbackFailed = parameters.error === 'authentication';

  return (
    <AuthenticationShell
      eyebrow="Account access"
      title="Welcome back."
      description="Continue through our managed identity provider, then return to your protected account without exposing credentials to this page."
      footer={
        <p>
          New to Crypto Lending?{' '}
          <Link href={`/register?returnTo=${encodeURIComponent(returnPath)}`}>
            Create an account
          </Link>
        </p>
      }
    >
      <LoginForm key={returnPath} returnPath={returnPath} initialError={callbackFailed} />
    </AuthenticationShell>
  );
}
