import { lendingRoutingFee, SAME_CHAIN_LENDING_FEE_BPS } from '../../../../onchain/src/lending-fee';
import type { BridgeStep, LocalWalletConfig } from '../mainnet/bridge-types';

export function lendingFeeEvidence(config: LocalWalletConfig, network: string, action: string, principal: bigint, bridged: boolean) {
  const basisPoints = action === 'supply' && !bridged ? SAME_CHAIN_LENDING_FEE_BPS : 0;
  const fee = lendingRoutingFee(principal, basisPoints);
  return { routingFeeVersion: '1', routingFeeBps: String(basisPoints), platformFee: fee.toString(),
    totalSourceDebit: (principal + fee).toString(), feeTreasury: network === 'eip155:1' ? config.ethereumTreasury : config.solanaTreasury };
}

/** Independent browser/server check; legacy reviews remain recoverable, not spendable. */
export function validateLendingFee(step: BridgeStep, config: LocalWalletConfig, spending = false) {
  const e = step.evidence;
  if (e.asset !== 'USDC') throw new Error('Unexpected lending asset.');
  if (!e.routingFeeVersion) {
    if (e.platformFee !== '0' || spending) throw new Error('Refresh this deposit to review the current routing fee.');
    return;
  }
  const principal = step.kind === 'LENDING_WITHDRAW' ? 0n : BigInt(e.lendAmount ?? e.amount!);
  const expected = lendingFeeEvidence(config, step.network, step.kind === 'LENDING_WITHDRAW' ? 'withdraw' : 'supply', principal, Boolean(e.fundingBridgeId));
  if (Object.entries(expected).some(([key, value]) => e[key] !== value)) throw new Error('The lending routing fee or treasury differs from the review.');
}
