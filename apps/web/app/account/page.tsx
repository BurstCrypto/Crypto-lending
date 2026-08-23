import { AccountSession } from '@/components/authentication/account-session';
import { AuthenticationShell } from '@/components/authentication/authentication-shell';

export const dynamic = 'force-dynamic';

export default function AccountPage() {
  return (
    <AuthenticationShell
      eyebrow="Protected account"
      title="Your account."
      description="Review the contact details attached to your authenticated Crypto Lending profile and leave securely when you are finished."
    >
      <AccountSession />
    </AuthenticationShell>
  );
}
