import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { loadAndVerifyPublicLaunchAuthorityDecision } from './public-launch-authority-decision';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const TARGET_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

interface RailwayApprovalPaths {
  readonly decisionPath: string;
  readonly evidencePath: string;
  readonly planPath: string;
  readonly releaseManifestPath: string;
  readonly targetId: string;
}

export interface VerifiedRailwayDeploymentApproval {
  readonly authorityDecisionSha256: string;
  readonly deploymentTargetConfigurationSha256: string;
  readonly productionEvidenceBundleSha256: string;
  readonly releaseCandidateManifestSha256: string;
  readonly validUntil: string;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function verifyRailwayDeploymentApproval(
  paths: RailwayApprovalPaths,
): VerifiedRailwayDeploymentApproval {
  if (!TARGET_PATTERN.test(paths.targetId)) throw new Error('Invalid Railway deployment target id');
  const releaseCandidateManifestSha256 = sha256File(paths.releaseManifestPath);
  const deploymentTargetConfigurationSha256 = sha256File(paths.planPath);
  const productionEvidenceBundleSha256 = sha256File(paths.evidencePath);
  const verified = loadAndVerifyPublicLaunchAuthorityDecision(paths.decisionPath, {
    releaseCandidateManifestSha256,
    deploymentTargetId: paths.targetId,
    deploymentTargetConfigurationSha256,
    productionEvidenceBundleSha256,
  });
  if (!SHA256_PATTERN.test(verified.decisionSetSha256)) {
    throw new Error('Verified authority decision did not produce a canonical digest');
  }
  return Object.freeze({
    authorityDecisionSha256: verified.decisionSetSha256,
    deploymentTargetConfigurationSha256,
    productionEvidenceBundleSha256,
    releaseCandidateManifestSha256,
    validUntil: verified.validUntil,
  });
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
}

function main(): void {
  const result = verifyRailwayDeploymentApproval({
    decisionPath: argument('--decision'),
    evidencePath: argument('--evidence'),
    planPath: argument('--plan'),
    releaseManifestPath: argument('--release-manifest'),
    targetId: argument('--target-id'),
  });
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    const lines = Object.entries(result)
      .map(([name, value]) => `${name}=${value}`)
      .join('\n');
    appendFileSync(outputPath, `${lines}\n`, { encoding: 'utf8', mode: 0o600 });
  } else {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
