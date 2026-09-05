# Offline production preflight

Run the bounded production blocker audit from the repository root:

```powershell
npm run production:preflight
```

The command defaults to the authenticated read-only target. To inspect the
stricter mainnet-write target or consume deterministic JSON, run:

```powershell
npx tsx scripts/production-go-live-preflight.ts --target mainnet-write
npm run --silent production:preflight:json
```

This is currently a `BOOTSTRAP_BLOCKER_AUDIT`, not a launch-certification
command. With no explicit bundle, its repository loader does not discover or
ingest controlled production evidence, so both targets remain blocked today.
The offline ingestion boundary is opt-in only:

```powershell
npx tsx scripts/production-go-live-preflight.ts `
  --evidence-bundle <controlled-canonical-json-path> `
  --release-manifest <verified-release-manifest-path> `
  --source-revision <current-clean-40-hex-revision> `
  --public-launch-authority-decision <seven-role-canonical-json-path>
```

The first three technical-evidence arguments are required together and are
rejected with the `mainnet-write` target. The authority path is accepted only
alongside that complete trio. Supplying the technical trio without the
authority path is allowed so the report can return
`PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING` with exit code `1`; an authority path
alone, a partial trio, a duplicate option, or a missing option value is an
argument error with exit code `2`.

The evidence path must identify a nonempty, single-link regular file capped at
256 KiB. Every existing intermediate path component and the final path is
checked for a symbolic link or Windows junction before and after the read. The
file is read twice through one descriptor; both byte sequences must match, and
the opened file's identity, link count, size, and timestamps must remain stable.
The authority-decision file has the same fail-closed link, regular-file,
identity, and double-read requirements with a 128 KiB cap.
There is no environment variable, default path, directory scan, secret-store
lookup, or network fallback for either controlled artifact. Input must be
strict UTF-8 and the entire file must be the compact, sorted-key canonical JSON
representation of the closed schema; a BOM, trailing newline, duplicate or
unknown field, malformed encoding, and noncanonical whitespace are rejected.

The release manifest is not a caller-provided revision assertion. Preflight
accepts only the exact object branded by
`loadAndVerifyReleaseManifest(workspaceRoot, path, expectedRevision)`, which
requires the requested revision to be the current clean `HEAD`/tree and
recomputes the fixed release components. The signed
`releaseCandidateManifestSha256` must equal that object's domain-separated
`payloadSha256`, and the bundle revision must equal its source revision. The
same branded manifest and source state are revalidated after bundle verification
and immediately before evidence application.

The closed bundle is `READ_ONLY`. It binds canonical issuance/expiry timestamps,
the branded release candidate, platform-directory SHA-256, a checked-in
deployment-target ID and SHA-256, direct authentication-deployment,
external-egress, and RPC-live observations, and the live-read evidence index.
Arbitrary evidence paths, reference IDs, and caller-asserted artifact hashes are
not part of an authority decision. `mainnetWriteEvidenceIndex` must be literal
`null`; write scope, action-binding, simulation, reconciliation, or financial-
authorization claims fail the closed schema. The validity window is at most 24
hours, each observation must precede issuance by no more than one hour, issuance
cannot be in the future, and expiry is exclusive. Freshness is checked both when
the bundle is verified and again when it is applied.

Every accepted payload needs an Ed25519 quorum over identical domain-separated
canonical bytes: one `DEPLOYMENT_EVIDENCE_ISSUER` and one separately scoped
`INDEPENDENT_RELEASE_VERIFIER`. Role, scope, key ID, and signature are closed
fields. The two roles must use distinct key IDs and distinct public-key material;
one physical key cannot occupy both roles. Additional recognized release-review
signatures may be cryptographically retained in the technical bundle, but
cannot replace either technical role, increase this read-only evidence
authority, or satisfy the separate public-launch authority gate.

`PUBLIC_LAUNCH_AUTHORITIES` is a non-bypassable check in both read-only and
mainnet-write readiness. It requires one distinct, current Ed25519 decision for
each exact `PUBLIC_MAINNET_LAUNCH` role: Legal Public Launch, Regulatory
Compliance, Privacy, Operations Acceptance, Independent Security, Dependency
Risk, and Deployment Owner. Every decision says explicit `APPROVED`, expires
within seven days, uses distinct key material, and signs the same binding. The
binding is derived only from the already verified technical bundle:

- `releaseCandidateManifestSha256` is the bundle's exact release-manifest hash;
- `deploymentTargetId` is the bundle's exact checked-in target ID; and
- `deploymentTargetConfigurationSha256` is the bundle's exact
  `deploymentTargetSha256`.

The CLI does not accept any of those binding values from separate arguments.
It loads the authority artifact only after technical-evidence verification and
then, immediately before calculating readiness, revalidates the branded
technical bundle, current clean release-manifest/worktree state, evidence
expiry, and the authority decision's private production brand, signatures,
binding, and expiry. Test-registry results, booleans, structural copies, stale
decisions, and caller-created bindings emit
`PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED`; they cannot clear the check. See
the [public launch authority gate](public-launch-authority-gate.md) for the
closed format and filesystem boundary.

Trust anchors come only from the exact checked-in authority-key registries; an
artifact cannot add a key or change key role/scope. Both the technical-evidence
and public-launch registries have no approved key today. The exact checked-in
deployment-target registry is also empty. A
future target record must bind environment, AWS account and region, HTTPS public
origin, coherent Cognito pool/client/login-host/issuer values, and immutable
digest-pinned image plus task-definition identities for the API, web, outbox
worker, and migration task. API, worker, and migration may share an image digest,
but all task-definition revisions must be distinct. Adding either a key or a
target is a separate reviewed source change and has not happened here.

Verified evidence may only supplement the three live/deployed evidence flags,
the manifest-bound source revision, and signed live-read index. It cannot override the
repository's authentication wiring inspection, egress policy status or mode,
RPC decision/approval/runtime status, platform directory, or any other local
approval boundary. A signed claim therefore cannot turn `NOT_APPROVED` into
`APPROVED`; those repository-side blockers continue to win. Schema v1 always
sets supplied write evidence to `null` and cannot affect mainnet-write readiness.

For the current release decision, the only active mainnet networks are
Ethereum and Solana. The ten-provider target is the exact six-Ethereum/four-
Solana planning set in the [production go-live plan](production-go-live-plan.md).
Base and BNB Smart Chain are deferred. A preflight or evidence total that
includes either deferred chain cannot satisfy the active launch target.

Exit code `1` means at least one named blocker remains. Exit code `2` means the
arguments or controlled evidence were rejected. CLI failures are reduced to
`PRODUCTION_PREFLIGHT_ARGUMENT_INVALID` or
`PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID`, or
`PUBLIC_LAUNCH_AUTHORITY_DECISION_INVALID`; paths, artifact contents, key
material, parser details, and signature details are never printed. Structural
or synthetic technical inputs cannot return exit code `0` without the private,
current seven-role production decision brand. The checked-in empty registries
therefore make exit code `0` impossible today. Even after independently
approved keys, evidence, and decisions exist,
`LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL` remains in the report.

The audit reads only local repository, non-secret artifacts: ECS environment and
secret-reference names, the inert KAN-231 egress example, the KAN-62 provider
decision record and digest, and the mainnet platform capability directory. It
does not scan implementation source for status phrases, derive application
configuration from process-environment values, read secret material or `.env` files, contact
provider endpoints, or accept catalog status strings as adapter evidence. An
explicit evidence flow adds bounded local manifest/evidence reads and the
release-manifest boundary's scrubbed, noninteractive local Git inspection. It
may copy the minimum operating-system variables needed to launch trusted Git,
but does not treat them as application configuration and does not trust caller
Git control variables. The command performs no DNS,
network, cloud, provider, secret, credential, transaction, or filesystem-write
operation.

`localValidation: PASS` means only that static inspection or an artifact's
structural contract passed. `launchReadiness: BLOCKED` takes precedence when
approval, runtime evidence, production wiring, or the provider target remains
incomplete. Provider counts can advance only from a closed-shape evidence index
that is independently bound to the exact source revision and platform-directory
SHA-256. Read evidence also requires explicit adapter-binding and composition
evidence; write evidence additionally requires action binding, simulation,
reconciliation, and independent security-review evidence.

Bootstrap mode deliberately sets `sourceRevision` to `null`: reading Git `HEAD`
alone cannot prove that the index and worktree are clean. Controlled ingestion
obtains the revision from the independently recomputed and branded release
manifest, then requires the signed bundle to match it exactly. The read-only
evidence schema cannot carry a write provider set.

The read-only target has a separate isolation gate. It is blocked if the
directory exposes any financial-authorization flag, transaction-enabled status,
or supported action, including when the surrounding directory is malformed.

Separately, the production API module graph and generated OpenAPI contract omit
all synthetic local-demo and Solana/EVM public-testnet transaction controllers.
Unknown or absent runtime labels fail to that smaller graph; only exact
`development` or `test` labels may add the local harness, whose loopback gates
remain in force. API unit tests and the CI OpenAPI regeneration check protect
this route-surface boundary. It does not alter any provider approval or preflight
blocker status.

The current machine-readable launch blockers include:

- `AUTH_DEPLOYED_EVIDENCE_MISSING`
- `EGRESS_POLICY_NOT_ACCEPTED`
- `EXTERNAL_EGRESS_DISABLED`
- `RPC_PROVIDER_EXTERNAL_APPROVAL_PENDING`
- `RPC_PROVIDER_RUNTIME_NOT_APPROVED`
- `LIVE_READ_EVIDENCE_INDEX_MISSING`
- `LIVE_PROVIDER_TARGET_NOT_MET`
- `PUBLIC_LAUNCH_AUTHORITY_DECISION_MISSING`
- `MAINNET_WRITE_EVIDENCE_INDEX_MISSING`
- `MAINNET_TRANSACTION_PROVIDER_TARGET_NOT_MET`

Static inspection currently requires the complete Cognito/OIDC, API
mainnet-wallet, current pre-authentication key, all six authentication/wallet
ring-document selectors, and web-origin task wiring with its exact reviewed
values and CloudFormation expressions. It pins `NODE_ENV=production`, requires
`LOCAL_DEMO_MODE` to be absent, rejects every legacy single-key auth/wallet
selector, and checks the Cognito issuer/JWKS and login-host derivations,
client/audience reference, HTTPS callback/origin paths, algorithm, token use,
timeouts, TTLs, trusted-proxy inputs, mainnet wallet mode, and each JSON secret
selector under the one external secret ARN. A nonempty substitute, alternate
`!Ref`/`!Sub`, attacker-controlled host, wrong selector, extra legacy field, or
safe-looking mode change is not counted as the required binding and emits the
applicable configuration/reference blocker. The current exact template omits
those local wiring blocker IDs and remains at zero desired tasks. This proves
only that the authored template matches the migration-`0025` fail-closed
configuration contract; it does not prove that the secret exists, its rings are
valid, or a task can read them.

`AUTH_DEPLOYED_EVIDENCE_MISSING` remains by design: the repository neither
provisions nor contacts Cognito, Secrets Manager, or KMS, and the inspector never
converts authored YAML into deployed acceptance.

The separate balance-sync source/DLQ and publisher wiring likewise cannot clear
a live-read blocker. No dedicated consumer task/service, receive/delete IAM
capability, or Ethereum/Solana RPC egress is active.

Run the focused checks with:

```powershell
npm run lint:production:preflight
npm run typecheck:production:preflight
npm run test:production:preflight
```

These checks are also part of the root `lint`, `typecheck`, and `test` scripts
used by CI.
