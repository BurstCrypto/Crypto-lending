import { defineConfig } from 'hardhat/config';

if (!process.connected || typeof process.send !== 'function') {
  throw new Error('Local EVM child requires its owning supervisor IPC tether');
}
process.once('disconnect', () => process.exit(1));

// KAN-256 never compiles or deploys Solidity. The chain has no configured
// accounts, and fixture bytecode is installed before the owned child becomes
// RUNNING. A zero base fee lets its keyless synthetic controller submit mined
// local fixture transactions at zero simulated cost. This keeps keys and
// compiler downloads out of the runtime entirely.
export default defineConfig({
  paths: {
    cache: '../../.local-validation/kan-256/hardhat-cache',
    artifacts: '../../.local-validation/kan-256/hardhat-artifacts',
  },
  networks: {
    node: {
      type: 'edr-simulated',
      chainType: 'l1',
      chainId: 31337,
      networkId: 31337,
      accounts: [],
      initialDate: '2026-08-25T00:00:00.000Z',
      initialBaseFeePerGas: 0,
      loggingEnabled: false,
      mining: {
        auto: true,
        interval: 0,
      },
    },
  },
});
