import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PhantomPanel } from '../src/app';

describe('PhantomPanel lifecycle', () => {
  it('survives React StrictMode effect replay without reusing a destroyed adapter', async () => {
    const view = render(
      <StrictMode>
        <PhantomPanel onEvidence={vi.fn()} />
      </StrictMode>,
    );

    expect(await screen.findByRole('heading', { name: 'Phantom on Solana devnet' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Refresh discovery' })).toBeEnabled();

    view.unmount();
    await Promise.resolve();
  });
});
