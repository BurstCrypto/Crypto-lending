import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { verifyRailwayDeploymentApproval } from './verify-railway-deployment-approval';

describe('verifyRailwayDeploymentApproval', () => {
  it('rejects an arbitrary digest-shaped value instead of treating it as launch authority', () => {
    const directory = mkdtempSync(join(tmpdir(), 'railway-approval-'));
    try {
      for (const name of ['manifest', 'plan', 'evidence']) {
        writeFileSync(join(directory, name), name, { mode: 0o600 });
      }
      writeFileSync(join(directory, 'decision'), `${'a'.repeat(64)}\n`, { mode: 0o600 });
      assert.throws(
        () =>
          verifyRailwayDeploymentApproval({
            decisionPath: join(directory, 'decision'),
            evidencePath: join(directory, 'evidence'),
            planPath: join(directory, 'plan'),
            releaseManifestPath: join(directory, 'manifest'),
            targetId: 'railway-production',
          }),
        /Public launch authority decision is invalid/u,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
