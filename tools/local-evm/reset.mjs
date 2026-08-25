import { sendLocalEvmControlCommand } from './control-channel.mjs';
import { requireAuthenticatedLocalEvmOwner } from './lifecycle-client.mjs';
import { LOCAL_EVM_MANIFEST } from './manifest.mjs';

const owner = await requireAuthenticatedLocalEvmOwner();
await sendLocalEvmControlCommand(owner, 'RESET');
process.stdout.write(
  `${LOCAL_EVM_MANIFEST.runtimeIdentity} fresh-child reset complete on ${LOCAL_EVM_MANIFEST.networkId}.\n`,
);
