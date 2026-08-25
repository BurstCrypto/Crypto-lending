import { sendLocalEvmControlCommand } from './control-channel.mjs';
import { requireAuthenticatedLocalEvmOwner } from './lifecycle-client.mjs';
import { LOCAL_EVM_MANIFEST } from './manifest.mjs';
import { assertNoAmbientProviderConfiguration } from './process.mjs';

const args = process.argv.slice(2);
if (
  args.length !== 4 ||
  args[0] !== '--wallet' ||
  args[2] !== '--usdc-atomic' ||
  typeof args[1] !== 'string' ||
  typeof args[3] !== 'string' ||
  !/^(?:0|[1-9][0-9]{0,77})$/u.test(args[3])
) {
  throw new TypeError(
    'Usage: local-evm:set-balance -- --wallet <local address> --usdc-atomic <integer>',
  );
}

assertNoAmbientProviderConfiguration();
const owner = await requireAuthenticatedLocalEvmOwner();
await sendLocalEvmControlCommand(
  owner,
  'SET_BALANCES',
  Object.freeze([
    Object.freeze({
      walletAddress: args[1].toLowerCase(),
      balanceAtomic: BigInt(args[3]).toString(),
    }),
  ]),
);
process.stdout.write(
  `${LOCAL_EVM_MANIFEST.runtimeIdentity} balance mutation published on ${LOCAL_EVM_MANIFEST.networkId}.\n`,
);
