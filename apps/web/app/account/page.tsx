import { AccountSession } from '@/components/authentication/account-session';
import { AuthenticationShell } from '@/components/authentication/authentication-shell';

export const dynamic = 'force-dynamic';

export default function AccountPage() {
  return (
    <AuthenticationShell
      activePage="account"
      eyebrow="Account"
      title="Your account."
      description="Review the contact details on your account or sign out securely."
    >
      <AccountSession />
    </AuthenticationShell>
  );
}
