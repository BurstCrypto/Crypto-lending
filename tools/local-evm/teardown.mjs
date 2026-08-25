import { localEvmEndpointsAreAbsent, sendLocalEvmControlCommand } from './control-channel.mjs';
import { findAuthenticatedLocalEvmOwner } from './lifecycle-client.mjs';
import { LOCAL_EVM_MANIFEST } from './manifest.mjs';
import { readLocalEvmControlRecord } from './runtime-state.mjs';

const owner = await findAuthenticatedLocalEvmOwner();
if (owner === null) {
  process.stdout.write(
    `${LOCAL_EVM_MANIFEST.runtimeIdentity} has no authenticated owner to stop.\n`,
  );
  process.exit(0);
}

await sendLocalEvmControlCommand(owner, 'STOP');
const deadline = Date.now() + 10_000;
let complete = false;
while (Date.now() < deadline) {
  let record;
  try {
    record = readLocalEvmControlRecord();
  } catch {
    record = 'INVALID';
  }
  if (record === null && (await localEvmEndpointsAreAbsent())) {
    complete = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
}
if (!complete) {
  throw new Error('Authenticated local EVM owner did not stop within the bounded window');
}
process.stdout.write(`${LOCAL_EVM_MANIFEST.runtimeIdentity} teardown complete.\n`);
