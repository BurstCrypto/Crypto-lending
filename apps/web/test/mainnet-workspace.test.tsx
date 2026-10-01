import { afterEach, expect, it, vi } from 'vitest';

const localContext = vi.hoisted(() => vi.fn());
vi.mock('@/lib/local-mainnet/page-context.server', () => ({
  localMainnetPageContext: localContext,
}));
import { MainnetWorkspace } from '../components/mainnet/workspace';
import { LocalMainnetTest } from '../components/mainnet/mainnet-test';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it.each(['local', 'production', 'deployment', 'ordinary-development'])(
  'keeps the same workspace and gates provider details to the local launcher: %s',
  async (mode) => {
    vi.stubEnv('NODE_ENV', mode === 'production' ? 'production' : 'development');
    vi.stubEnv('LOCAL_MAINNET_TEST_MODE', mode === 'ordinary-development' ? undefined : 'enabled');
    vi.stubEnv('LOCAL_MAINNET_TEST_LAUNCH_TOKEN', 'a'.repeat(64));
    vi.stubEnv('DEPLOYMENT_TARGET', mode === 'deployment' ? 'railway' : undefined);
    vi.stubEnv('LOCAL_DEMO_MODE', undefined);
    localContext.mockResolvedValue({ setupToken: 'a'.repeat(64) });
    const workspace = await MainnetWorkspace();
    expect(workspace.type).toBe(LocalMainnetTest);
    expect(workspace.props.showProviderDetails).toBe(mode === 'local');
    expect(workspace.props.setupToken).toBe(mode === 'local' ? 'a'.repeat(64) : '');
    expect(localContext).toHaveBeenCalledTimes(mode === 'local' ? 1 : 0);
  },
);
