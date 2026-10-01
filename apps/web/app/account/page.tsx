import { AccountSession } from '@/components/authentication/account-session';
import { AuthenticationShell } from '@/components/authentication/authentication-shell';
import { MainnetWalletAccount } from '@/components/mainnet/account';
import { localMainnetConfig } from '@/lib/local-mainnet/config.server';

export const dynamic = 'force-dynamic';

export default function AccountPage() {
  const localWalletMode = localMainnetConfig() !== null;
  return (
    <AuthenticationShell
      activePage="account"
      localWalletMode={localWalletMode}
      eyebrow="Account"
      title="Your account."
      description="Your wallet setup and account access."
    >
      <MainnetWalletAccount />
      {!localWalletMode && <AccountSession />}
    </AuthenticationShell>
  );
}
