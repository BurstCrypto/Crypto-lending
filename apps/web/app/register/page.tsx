import Link from 'next/link';

import { AuthenticationShell } from '@/components/authentication/authentication-shell';
import { RegistrationForm } from '@/components/authentication/registration-form';
import { safeAccountReturnPathOrDefault } from '@/lib/authentication';

interface RegisterPageProps {
  readonly searchParams?: Promise<{ readonly returnTo?: string | readonly string[] }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps = {}) {
  const parameters = searchParams ? await searchParams : {};
  const returnPath = safeAccountReturnPathOrDefault(parameters.returnTo);

  return (
    <AuthenticationShell
      eyebrow="New account"
      title="Start with a secure foundation."
      description="Tell us how to contact you and where you live. Your identity provider will handle the next step before the account is created."
      footer={
        <p>
          Already registered?{' '}
          <Link href={`/login?returnTo=${encodeURIComponent(returnPath)}`}>Sign in</Link>
        </p>
      }
    >
      <RegistrationForm key={returnPath} returnPath={returnPath} />
    </AuthenticationShell>
  );
}
