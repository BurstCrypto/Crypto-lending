import { AuthenticationShell } from '@/components/authentication/authentication-shell';
import { RegistrationForm } from '@/components/authentication/registration-form';
import { safeAccountReturnPathOrDefault } from '@/lib/authentication';

interface RegisterPageProps {
  readonly searchParams?: Promise<{ readonly returnTo?: string | readonly string[] }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const parameters = searchParams ? await searchParams : {};
  const returnPath = safeAccountReturnPathOrDefault(parameters.returnTo);

  return (
    <AuthenticationShell
      activePage="register"
      authenticationActionHref={`/login?returnTo=${encodeURIComponent(returnPath)}`}
      eyebrow="Get started"
      title="Create your account."
      description="Add your contact details, then complete the secure identity step."
    >
      <RegistrationForm key={returnPath} returnPath={returnPath} />
    </AuthenticationShell>
  );
}
