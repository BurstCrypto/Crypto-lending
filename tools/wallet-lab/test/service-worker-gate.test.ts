import { describe, expect, it, vi } from 'vitest';

import { assertNoServiceWorkerContext } from '../src/service-worker-gate';

describe('wallet lab service-worker gate', () => {
  it('blocks a controller or registration and permits an empty context', async () => {
    await expect(
      assertNoServiceWorkerContext({
        controller: {} as ServiceWorker,
        getRegistrations: vi.fn(async () => []),
      }),
    ).rejects.toThrow('service-worker-controller-present');

    await expect(
      assertNoServiceWorkerContext({
        controller: null,
        getRegistrations: vi.fn(async () => [{} as ServiceWorkerRegistration]),
      }),
    ).rejects.toThrow('service-worker-registration-present');

    await expect(
      assertNoServiceWorkerContext({
        controller: null,
        getRegistrations: vi.fn(async () => []),
      }),
    ).resolves.toBeUndefined();
  });
});
