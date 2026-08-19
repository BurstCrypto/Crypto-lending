import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const WALLET_LAB_TEST_ROOT = dirname(fileURLToPath(import.meta.url));

// Tests intentionally use a separate config so the real development-server
// config can always fail closed when HTTPS or access credentials are absent.
export default defineConfig({
  root: WALLET_LAB_TEST_ROOT,
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
