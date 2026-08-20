# KAN-35: Continuous integration and controlled delivery

Status: **LOCAL CONTROL PLANE IN PROGRESS; LIVE DELIVERY NOT RUN**

This ticket establishes a reproducible, fail-closed path from a reviewed source
revision to versioned API, worker, and web artifacts. The current work is bound
by a strict zero-spend rule. Repository edits and local validation are allowed;
AWS resources, ECR publication, GitHub Actions runs, deployments, and rollback
rehearsals are not authorized by this ticket work alone.

## Cost and authority boundary

The following remain prohibited until a separate, explicit approval names the
account, Region, environment, time window, expected cost, and operator:

- pushing images or metadata to ECR or any other paid registry;
- creating or changing AWS, DNS, GitHub environment, or branch-protection state;
- running a CloudFormation plan or deployment, migration task, or live rollback;
- dispatching GitHub Actions or pushing a branch when that push would start a
  billable hosted workflow;
- enabling an automatic deployment workflow.

The repository contains no active deployment workflow. Its application
invocation script still defaults to local validation and retains the existing
KAN-229 billing and KAN-230 certificate/DNS gates. A valid KAN-35 release record
is an additional binding input; it is not spending authorization.

## Implemented local controls

### CI policy

`.github/workflows/ci.yml` keeps one fail-closed `validate` job so an existing
required-check name is not silently changed. It now:

- runs only for pull requests, `main` pushes, or an explicit manual dispatch;
- pins the Ubuntu runner family, exact Node.js/npm toolchain, and every GitHub
  Action to a reviewed commit SHA;
- grants only `contents: read`, stores no checkout credential, references no
  secret or deployment environment, and has no OIDC or deployment job;
- applies formatting, lint, type, unit, Jira security, end-to-end, build,
  OpenAPI, migration, and Docker-backed infrastructure gates in order;
- names uploaded diagnostic/OpenAPI artifacts with the source SHA and run
  attempt, and verifies the OpenAPI checksum and upload digest;
- cancels superseded validation for the same pull request or branch.

`infra/ci/validate-workflows.mjs` validates that policy across every active
workflow and mutation tests the important fail-open cases. In addition to its
semantic checks, it requires the complete normalized workflow to match a
reviewed SHA-256. Any workflow text change—including an obfuscated command,
implicit `github.token` use, or an extra step—therefore requires an explicit
policy update and review. This is repository defense-in-depth, not a substitute
for protected reviews or a network sandbox around code invoked by an approved
step.

### Reproducible application artifacts

The API/worker and web Dockerfiles use a literal digest-pinned Node.js base, the
literal repository npm version, `npm ci`, and an exact deny-all build-context
allowlist. Those toolchain inputs cannot be replaced with Docker build arguments.
Runtime images use UID:GID `10001:10001` and contain source-revision/version OCI
labels. The backend image includes the official RDS global CA bundle with both
an exact SHA-256 and byte-length assertion. The web build ID is the full source
revision, with a deterministic local-only fallback when no release revision is
supplied.

The local container harness parses the reviewed stage graph and final runtime
instructions, rejects root/alternate users and command/entrypoint overrides, and
validates the exact build-context rule set without Docker, registry credentials,
or network access. Its optional build path requires a clean checkout and an
explicit network-download acknowledgement, never pulls a base implicitly, and
never pushes. Its optional smoke path starts the API and web images with no
network, a read-only filesystem, all capabilities dropped,
no-new-privileges, and the unprivileged runtime identity. It validates the
worker image command, health check, identity, labels, and required files, but
does not yet start the worker process.

Docker build and smoke execution are deliberately **NOT RUN** in this batch:
building requires retrieving the exact npm packages and checksum-pinned RDS
bundle, and there is no approved release publication or live environment.

### Migration gate

The migration CLI now has a `verify` command backed by
`MigrationRunner.assertUpToDate()`. It exits nonzero for pending or unknown
migrations and preserves checksum/schema-definition verification. The CI
migration lifecycle is:

```text
up -> verify -> down one -> up -> verify
```

The existing isolated full-rollback integration suite remains responsible for
the complete down path. A future deployment must run and verify the exact
digest-bound migration task before application desired counts are raised.

### Release and rollback binding

`infra/aws/release-deployment-control-record.schema.json` and its semantic
validator bind all of the following into one canonical SHA-256 record:

- a full 40-character source revision;
- digest-pinned API, web, and worker ECR URIs in one approved account/Region;
- the application template digest and complete explicit CloudFormation
  parameter map;
- the exact nonproduction environment, stack, change-set name, and type;
- CI, unit, integration, migration, reproducibility, and artifact-versioning
  evidence;
- distinct approval and independent-verification roles;
- either a deployment intent or an explicit prior-record rollback with database
  compatibility evidence. Rollback loads and hashes the local prior approved
  DEPLOY record, matches its source, images, build/provenance bindings, and every
  parameter, and permits only explicitly recorded desired-count differences for
  current rollout capacity.

The example record stays `NOT_APPROVED`/`NOT_RUN`. Approved records and build
evidence are operational artifacts and are ignored by Git.

For an authorized future Plan, `invoke-application-baseline.ps1` requires an
independently supplied expected release-record digest, validates the record
before credential discovery, exact-compares every planned parameter, and binds
its canonical digest/source/action to the change-set tags and description. A
rollback also requires the exact local prior-record file. Deploy independently
reconstructs and compares those bindings, the complete described parameter set,
change-set type, safe execution context, and current stack version before
allowing an exact reviewed change set to execute. It requires exactly the
reviewed IAM capability, rejects notification/rollback/nested/import/express-mode
overrides, explicitly pins `OnStackFailure=ROLLBACK` for CREATE change sets, and
requires the associated stack to have no persisted CloudFormation service role.
Deploy rejects a missing or weaker CREATE failure policy and any UPDATE failure
override. It does not accept a change set merely because that change set describes
itself consistently.

The canonical digest authenticates nothing by itself: role aliases, gate values,
and evidence references are record assertions, not signatures or fetched
attestations. The expected digest must eventually come from a protected approval
channel with verified evidence and distinct reviewers. No such GitHub
environment, signature trust root, or live evidence channel was created or
verified in this zero-spend batch, so the invocation guard must not be described
as deployment authorization on its own. The guard checks the associated stack's
observable service-role state; IAM must additionally prevent an operator from
supplying an unapproved CloudFormation role because the change-set description
response does not expose that create-time input directly.

## Local, zero-external-call checks

These KAN-35 policy checks read only repository files:

```powershell
npm run ci:test:policy
npm run ci:validate:policy
npm run containers:check
npm run infra:validate:release
npm run infra:test:release
pwsh -NoProfile -File infra/aws/test-invoke-application-baseline.ps1
```

The broader local application gates remain:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e --workspace @crypto-lending/api
npm run build
npm run infra:validate
```

Do not run the repository's manual workflow, push this branch, build/publish
release images, or invoke any AWS action merely because these checks pass.

## Acceptance and residual work

| Criterion                                        | Current evidence                                                                                 | Live status                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Reproducible source and dependency inputs        | Pinned toolchain/actions/base image, lockfile checks, deterministic build ID, OCI source labels  | Node/container path local only; Python closure remains open |
| Unit, integration, migration, and contract gates | Fail-closed workflow definition plus local command/test coverage                                 | Hosted workflow **NOT RUN**                                 |
| Failed checks block merge or deployment          | One stable validation context; deploy input requires every recorded gate to pass                 | GitHub ruleset/environment state **NOT VERIFIED**           |
| Passing change deploys to nonproduction          | Exact release-to-change-set control path prepared                                                | **NOT RUN / NOT AUTHORIZED**                                |
| Prior versioned artifact can be redeployed       | Rollback record binds prior record digest, source, images, current version, and DB compatibility | No published prior artifact; **NOT RUN**                    |

Before live acceptance, an authorized operator must separately provide and
verify KAN-229/KAN-230 prerequisites, GitHub required-check/environment rules,
registry retention and cost approval, image digests plus SBOM/provenance/security
evidence, a migration plan, deployment health evidence, rollback evidence, and
cleanup. The runner-provided Python patch and `cfn-lint` transitive dependency
closure are not yet hash-locked, so the CloudFormation-lint toolchain is not
bit-for-bit reproducible. API/worker runtime source-version reporting, signed
provenance, SBOM generation, immutable registry retention, and live image
verification also remain open. The OpenAPI payload has internal and uploaded
artifact digests, but those digests are not yet fields in the release record.
KAN-54 remains the dependency for the broader vulnerability-scanning decision.
Until then KAN-35 must not be represented as deployed or complete.
