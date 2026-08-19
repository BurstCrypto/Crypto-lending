import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { resolveWalletLabBootstrapGate } from './bootstrap-gate';
import { assertNoServiceWorkerContext } from './service-worker-gate';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Wallet lab root element was not found.');

const root = createRoot(container);
const gate = resolveWalletLabBootstrapGate(import.meta.env, window.location.origin);

function renderBlocked(reason: string, heading = 'Restricted runtime gate closed') {
  root.render(
    <StrictMode>
      <main className="shell blocked-shell">
        <p className="eyebrow">Wallet lab disabled</p>
        <h1>{heading}</h1>
        <p>
          Reason: <code>{reason}</code>
        </p>
        <p>
          Copy <code>.env.example</code> to <code>.env.local</code>, explicitly enable the lab, and
          run it through the repository’s localhost-only command.
        </p>
      </main>
    </StrictMode>,
  );
}

if (!gate.enabled) {
  renderBlocked(gate.reason);
} else {
  // Wallet SDK and connector modules are not evaluated until the global
  // development/feature/origin gates above have passed.
  void assertNoServiceWorkerContext(
    'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  )
    .then(() => import('./live'))
    .then(({ renderLiveWalletLab }) => renderLiveWalletLab(root))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '';
      const reason =
        message === 'service-worker-controller-present' ||
        message === 'service-worker-registration-present'
          ? message
          : 'live-runtime-load-failed';
      renderBlocked(reason, 'Wallet runtime could not start');
    });
}
