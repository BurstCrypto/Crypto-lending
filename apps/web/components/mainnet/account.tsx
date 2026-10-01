import Link from 'next/link';

import { MAINNET_TREASURIES } from '@/lib/mainnet/public-config';
import styles from './mainnet-test.module.css';

export function MainnetWalletAccount() {
  const treasuries = MAINNET_TREASURIES;
  return <section className="account-profile" aria-labelledby="wallet-account-title">
    <div className="account-profile-heading">
      <div><p className="eyebrow">Wallet workspace</p><h2 id="wallet-account-title">Wallet setup</h2></div>
      <span className="portfolio-preview-badge">Mainnet</span>
    </div>
    <p className="authentication-form-note">Connect an Ethereum wallet, a Solana wallet, or both in Portfolio.</p>
    <dl className="account-profile-details">
      <div><dt>Ethereum treasury</dt><dd className={styles.address}>{treasuries.ethereumTreasury || 'Not configured'}</dd></div>
      <div><dt>Solana treasury</dt><dd className={styles.address}>{treasuries.solanaTreasury || 'Not configured'}</dd></div>
      <div><dt>Transaction approval</dt><dd>In your wallet</dd></div>
    </dl>
    <p className="authentication-form-note">These saved addresses receive the routing fee: 0.10% for same-network deposits and 0.20% for bridging. Mainnet transactions use real funds and gas.</p>
    <Link href="/portfolio#wallets" className="primary-action action-button">Connect wallets</Link>
  </section>;
}
