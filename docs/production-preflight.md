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

`PRODUCTION_INFRASTRUCTURE` separately inspects the exact environment-contract
markers across the KAN-34 application path: the parent, workload,
observability, migration, and account-guardrail templates; their deployment
guards; and the application, fixed-slot, billing, egress, auth/wallet, and
Redis-operator validators. The current reviewed matrix is deliberately
`NON_PRODUCTION_ONLY`, so its local inspection is `PASS` while launch readiness
is hard-blocked by
`PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED`. Missing, malformed,
mixed, forged, or superficially widened artifacts instead emit
`PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED`. A private in-process brand keeps
callers from replacing the inspected result with asserted booleans or a
fabricated `PRODUCTION_ENABLED` value.

This check recognizes the selected environment contract and guard markers; it
is not a substitute for the dedicated CloudFormation linters and artifact
validators. The standalone `sqs-foundation.yaml` is intentionally outside this
matrix because the KAN-34 parent owns its queues and is mutually exclusive with
that alternative stack for one environment. The standalone template remains
covered by its own validator and CI suite. Enabling a production-named path
requires a separate reviewed cost, billing, egress, rotation, and deployment
authority design; this checkpoint does not widen any template or authorize a
deployment.

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

The closed schema-v2 bundle is `READ_ONLY`. It binds canonical issuance/expiry
timestamps, the branded release candidate, platform-directory SHA-256, a
checked-in deployment-target ID and SHA-256, direct authentication-deployment,
RDS-master-lifecycle, external-egress, and RPC-live observations, and the
live-read evidence index. The v2 signing domain covers the complete new shape;
a legacy schema-v1 bundle or v1-domain signature fails closed rather than being
silently upgraded.
Arbitrary evidence paths, reference IDs, and caller-asserted artifact hashes are
not part of an authority decision. `mainnetWriteEvidenceIndex` must be literal
`null`; write scope, action-binding, simulation, reconciliation, or financial-
authorization claims fail the closed schema. The validity window is at most 24
hours, each observation must precede issuance by no more than one hour, issuance
cannot be in the future, and expiry is exclusive. Freshness is checked when the
bundle is verified, when it is applied, and whenever the exact branded input is
evaluated.

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
deployment-target registry is also empty. A future schema-v2 target record and
the v2 target-hash domain must bind environment, AWS account and region, HTTPS
public origin, coherent Cognito pool/client/login-host/issuer values, and
immutable digest-pinned image plus task-definition identities for the API, web,
outbox worker, and migration task. Its closed `rds` block must identify the
CloudFormation stack ID, database instance ARN, database resource ID,
RDS-managed secret ARN, and application-data KMS key ARN. API, worker, and
migration may share an image digest, but all task-definition revisions must be
distinct. Adding either a key or a target is a separate reviewed source change
and has not happened here.

Verified evidence may only supplement the closed live/deployed evidence fields,
the manifest-bound source revision, and signed live-read index. It cannot
override the repository's authentication wiring inspection, RDS-managed-master
template inspection, egress policy status or mode, RPC
decision/approval/runtime status, platform directory, or any other local
approval boundary. A signed claim therefore cannot turn `NOT_APPROVED` into
`APPROVED`; those repository-side blockers continue to win. Schema v2 always
sets supplied write evidence to `null` and cannot affect mainnet-write
readiness.

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
and the deliberately non-production infrastructure contract independently make
exit code `0` impossible today. Even after independently approved keys,
evidence, decisions, and a separately reviewed production deployment path
exist,
`LOCAL_VALIDATION_IS_NOT_PRODUCTION_APPROVAL` remains in the report.

The audit reads only local repository, non-secret artifacts: selected KAN-34
environment-contract and guard markers, ECS environment and secret-reference
names, the inert KAN-231 egress example, the KAN-62 provider decision record and
digest, and the mainnet platform capability directory. It
parses the egress record as strict UTF-8 JSON and rejects byte-order marks or
duplicate object keys before evaluating its status, mode, or evidence fields. It
loads that record through the same bounded, canonical-path, stable double-read
boundary used by the standalone egress gate. It
derives KAN-62 local validation and every provider approval/runtime field from
one immutable parsed snapshot of the exact decision bytes bound by that digest;
it never re-reads status fields from a second, potentially different snapshot.
Both controlled files must be non-empty, bounded, single-link regular files at
canonical repository paths. Each file is descriptor-bound and read twice, so a
linked path, path replacement, size change, metadata change, or same-size rewrite
fails closed behind one sanitized validation error.
The decision must also be strict UTF-8 JSON without a byte-order mark or
duplicate object keys at any depth. Recomputing the SHA-256 sidecar cannot make
an ambiguous duplicate-key document eligible for local validation.
The audit does not scan implementation source for status phrases, derive
application configuration from process-environment values, read secret material
or `.env` files, contact provider endpoints, or accept catalog status strings as
adapter evidence. An
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

Relevant machine-readable launch blocker IDs include:

- `PRODUCTION_INFRASTRUCTURE_INSPECTION_FAILED`
- `PRODUCTION_INFRASTRUCTURE_DEPLOYMENT_PATH_NOT_ENABLED`
- `AUTH_DEPLOYED_EVIDENCE_MISSING`
- `DATABASE_MASTER_SECRET_NOT_RDS_MANAGED`
- `RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING`
- `REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED`
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
selector under the one external secret ARN. Inspection also requires one exact,
top-level, no-default/no-`NoEcho` `AuthWalletKeysSecretVersionId` parameter and
binds all seven selectors to it with an empty stage. An omitted version,
`AWSCURRENT`, `AWSPREVIOUS`, alternate version parameter, counterfeit nested
parameter, nonempty substitute, alternate `!Ref`/`!Sub`, attacker-controlled
host, wrong selector, extra legacy field, or safe-looking mode change is not
counted as the required binding and emits the applicable
configuration/reference blocker. The current exact template omits those local
wiring blocker IDs and remains at zero desired tasks. This proves only that the
authored template matches the migration-`0025` fail-closed configuration
contract; it does not prove that the secret/version exists, its rings are valid,
or a task can read it.

The same offline inspection loads the exact parent, workload-boundary child,
and observability child for the Redis break-glass credential. It requires one
explicit no-default `RedisOperatorSecretVersionId` propagated to both children,
an all-seven inert `UNPINNED` adoption gate, an off/passwordless operator user
before adoption, and the same exact stage-free version in the ElastiCache user
and conditional ECS revocation task. Omitted versions, `AWSCURRENT`,
`AWSPREVIOUS`, alternate parameters, mismatched child propagation, or an enabled
unpinned task emit `REDIS_OPERATOR_SECRET_VERSION_NOT_WIRED`.

Separate from that authored-template check, the repository now has a schema-v3
fixed-slot state with append-only Redis operator VersionId history, a dedicated
two-role-signed Redis-operator validator, and a deployment-integrated
`REDIS_OPERATOR_TRANSITION` intent. The local path accepts only no-op chain
adoption or one fresh VersionId append while the operator stays disabled and
its task stays absent; it binds the Redis, composite credential, and preserved
auth/wallet predecessors and constrains the reviewed nested change to the exact
operator-user authentication update. The production Redis-operator authority
registry is intentionally empty. This preflight does not ingest that transition
artifact or treat the local guard as live evidence: no operational record is
authorized, and no secret staging, AWS/Redis operation, deployment, or rotation
has occurred. External custody, signatures, approvals, live capture,
candidate/old-credential authentication, continuity, recovery, and deployed
verification remain blockers.

Parent-template inspection separately requires the RDS database to use the
literal `crypto_admin` master username, `ManageMasterUserPassword: true`, and
`MasterUserSecret.KmsKeyId: !GetAtt ApplicationDataKey.Arn`. It rejects a
custom `DatabaseCredentialsSecret`, any `MasterUserPassword` or Secrets Manager
dynamic reference, a different KMS binding, and a compatibility output that is
not exactly `!GetAtt Database.MasterUserSecret.SecretArn`. Missing or altered
wiring emits `DATABASE_MASTER_SECRET_NOT_RDS_MANAGED`. This check proves only
the exact hash-bound authored RDS-managed boundary; a private in-process brand
prevents callers from clearing it with a forged pair of success booleans. It
cannot prove the managed secret exists, uses the intended live key, is readable
only by the bootstrap operator, or follows the default seven-day rotation. A
recovery exercise must establish and bind the restored or replacement
database's managed-secret ARN; the original secret need not survive. Those
items remain deployed evidence and recovery gates.

The outer two-role-signed schema-v2 bundle now covers the closed nested
schema-v1 `rdsMasterLifecycleEvidence` record with type
`RDS_MASTER_LIFECYCLE_EVIDENCE` and status `ACCEPTED`. It binds the literal
`crypto_admin` master username, primary and restored database identities,
managed-secret ARNs and VersionIds, compatibility-output ARN, and
application-data/managed-secret KMS identities. Exact `PASS` fields cover
bootstrap IAM/KMS access, application and migration isolation, master-session
drain, completed managed rotation, new authentication, old-password denial,
runtime-credential continuity, and restore/rebinding. Its closed schema-v1
`supportingCapture` metadata names `RDS_MASTER_LIFECYCLE_CAPTURE` in
`SANITIZED_CANONICAL_JSON_V1` format, a lowercase `captureSha256`, and collection
start/completion timestamps. The outer signatures cover that digest, but the
validator deliberately does not open the separately retained capture file; the
issuer and independent verifier must each calculate the canonical capture hash
and match `captureSha256` before signing.

The primary database ARN, resource ID, managed-secret ARN, and application-data
key ARN must exactly match the schema-v2 deployment target's closed `rds` block;
the outer signatures also cover the v2 target digest, which includes that block's
CloudFormation stack ID. The
compatibility output and primary managed-secret ARN must agree, both primary and
restored secret KMS bindings must equal the target application-data key, and the
restored database and secret identities must be distinct and
target-account/Region bound. Primary, rotation, and restored managed-secret
status must be literal `active`; the current/previous rotation versions must be
distinct and labeled `AWSCURRENT`/`AWSPREVIOUS`, and the rebound restored version
must be labeled `AWSCURRENT`. Time ordering is closed as
`collectionStartedAt <= access.observedAt <= rotation.startedAt <
rotation.completedAt <= restore.startedAt < restore.completedAt =
collectionCompletedAt = observedAt`, within a maximum 24-hour capture window.

Preflight accepts that nested record only through the current outer
two-role-signed schema-v2 bundle bound to the exact release and deployment
target. Repository/no-bundle input, an absent or forged acceptance flag, and an
unbranded structural copy emit `RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING`. A
malformed, already stale, counterfeit, wrong-artifact/status/field, or
identity-mismatched bundle is rejected during load/application with the
sanitized `PRODUCTION_PREFLIGHT_EVIDENCE_BUNDLE_INVALID` error and produces no
preflight report. The exact branded input is revalidated during evaluation; if
previously accepted evidence later becomes stale,
`RDS_MASTER_LIFECYCLE_EVIDENCE_MISSING` returns, and a bound launch decision can
additionally fail public-authority revalidation with
`PUBLIC_LAUNCH_AUTHORITY_DECISION_UNVERIFIED`. This validates the signed
attestation, not RDS itself; collecting the authorized live evidence remains
external and no such record or capture exists today. The controlled record and
capture contain operational identifiers only. Passwords, `SecretString`,
connection material, and logs are forbidden, and neither the controlled bundle
nor separately retained capture may be checked into Git or Jira.

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
