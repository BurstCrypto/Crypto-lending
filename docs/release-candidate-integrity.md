# Release candidate integrity

The repository now produces a closed, revision-bound inventory of the exact
application build outputs, exact image-derived SBOMs, and production-preflight
decision inputs from a clean checkout. After all compiled-migration and
live-infrastructure tests pass, a
trusted-main CI run copies every inventoried byte into a fresh, self-contained
stage, revalidates both the source and the stage, and uploads only that stage as
permission-restricted GitHub artifact content. This is an integrity handoff for
later image construction and release review; it does not publish an image, deploy
infrastructure, approve external egress, or enable a mainnet write.

## Fixed manifest surface

`scripts/release-candidate-manifest.mjs` inventories only a reviewed, fixed
component set:

- the compiled API, migration CLI, outbox worker, and worker health entry point;
- the Next.js standalone server and separately required static assets;
- the generated OpenAPI contract, all three npm package manifests, and the exact
  npm lockfile;
- the exact Syft 1.51.1 SPDX JSON bytes, native records, and independently
  parsed Docker-save descriptor-chain records for the final local API and web
  runtime images;
- the API/web Dockerfiles, closed Docker build-context policy, pinned RDS trust
  bundle and digest, and offline source/runtime/OCI-metadata validators;
- the application, observability child, nested workload-boundary, and
  migration-task CloudFormation templates;
- the canonical offline production deployment-target and prospective-destination
  runtime, target-identity enrollment verifier, deployment-intent validator,
  shared Ed25519 public-key validator, and inert intent example; and
- every repository decision artifact directly inspected by production
  preflight: the authentication/application template, egress policy, RPC
  decision and its SHA-256 sidecar, the dated exact-byte active-scope provider
  research capture, mainnet platform directory, and its Ethereum/Solana network
  policy.

Each regular file has a size and SHA-256 digest. Each component has a
domain-separated digest over its sorted file inventory. The complete payload
has a canonical, domain-separated SHA-256 in `payloadSha256`, alongside the
exact 40-hex source revision, Git tree identity, Node version, platform, and
architecture. Paths outside the fixed workspace components, symbolic links,
junctions and other intermediate reparse points, multiply linked files, special
files, case/Unicode/platform-colliding names, missing runtime entry points,
oversized inputs, unstable reads, unknown fields, duplicate/noncanonical JSON,
and byte drift all fail closed.

The prospective-destination registry binds only pre-provision coordinates and
a nonzero epoch intended for single use; it rejects duplicate IDs, epochs, or
account/Region/stack tuples and is empty in production. The separately branded
deployed-target registry remains an empty, fail-closed legacy evidence boundary.
It cannot be populated safely by a release-bound source edit because generated
resource and image identities do not exist until after provisioning. The
dedicated post-provision enrollment verifier accepts only a short-lived,
two-role-signed target-identity claim bound to the exact prospective destination,
provision intent, reservation, result, source revision, release manifest, and
generated target. Its production authority registry is empty, and its accepted
report keeps external-state verification and execution authority false. It
performs no I/O, provisioning, enrollment mutation, live-state observation, or
deployment; a later consumer must independently establish live state and
atomically consume the destination epoch and chain head.

The deployment-intent and target-identity enrollment validators are staged with
their exact recursive local module closures. CI parses both closures, permits
only their reviewed Node built-ins and named imports, rejects direct
dynamic-loading, network I/O, cloud, subprocess, filesystem-write, and
environment access, and proves that native Node can import both entry points
from the sealed stage. The target runtime's `node:net` use is limited to the
pure `isIP` parser. This is a static direct-capability drift guard, not a
JavaScript sandbox or deployment authorization; both validators remain offline
and non-executing.

Generation additionally requires `HEAD` to equal the requested revision and
rejects any staged, unstaged, non-ignored untracked, sparse, skip-worktree, or
assume-unchanged source state. Git runs through a fixed platform-owned
executable with an explicit worktree and Git directory, no system/global
configuration, and a closed environment; ambient `GIT_DIR`, `GIT_WORK_TREE`,
index/object/config overrides, and `PATH` cannot redirect inspection. Release
inspection requires a physical primary checkout with a real `.git` directory.
Ignored build output is intentionally hashed as release content rather than
treated as source. CI runs manifest generation only after build, OpenAPI drift
verification, final local image construction, hardened-runtime checks, image
SBOM generation, and fail-closed SBOM validation.

Every fixed path segment is checked physically beneath the workspace before and
after descriptor-based reads. Verification performs two complete byte scans
between clean-source checks. This detects ordinary concurrent drift, but a
mutable workspace is never the delivery artifact: the later `stage` operation
uses exclusive files in a newly created physical directory, copies and verifies
every manifest component, revalidates the original branded candidate, and then
makes every staged file read-only before publication. Directory names used for
sealing come only from the validated manifest. On POSIX, each known directory is
opened with `O_DIRECTORY | O_NOFOLLOW`, matched to its pre-open identity, changed
to mode `0500` through its descriptor, and matched to the same path and inode
again. No directory discovered in a listing is recursively traversed for a
permission change. Windows does not expose equivalent directory-descriptor
permission semantics through Node.js, so the implementation performs exact
expected-entry checks over manifest-derived directories and does not attempt
path-based directory `chmod`; exclusive single-link staged files are still made
read-only and all bytes are reverified.

## Local use

From an exact clean release checkout, after the normal build and OpenAPI lane:

```powershell
npm run build
npm run openapi:generate
git diff --exit-code -- apps/api/openapi.json
# Build both reviewed images with --provenance=false and generate each pinned
# SPDX/native pair, then capture each Docker-save descriptor chain:
$ApiImageId = docker image inspect --format '{{.Id}}' crypto-lending-api:ci
$WebImageId = docker image inspect --format '{{.Id}}' crypto-lending-web:ci
$ReleaseRevision = git rev-parse HEAD
npm run production:sbom:capture -- api crypto-lending-api:ci `
  $ApiImageId .local-validation/production-sbom/api-image.binding.json
npm run production:sbom:capture -- web crypto-lending-web:ci `
  $WebImageId .local-validation/production-sbom/web-image.binding.json
npm run production:sbom:validate -- $ApiImageId $WebImageId $ReleaseRevision
npm run release:manifest -- create --source-revision $ReleaseRevision
npm run release:manifest -- verify --source-revision $ReleaseRevision
npm run release:manifest -- stage --source-revision $ReleaseRevision
```

The fixed manifest output is
`.local-validation/release-candidate-manifest.json`. Creation is exclusive: the
path must not already exist, and `.local-validation` must be a physical
directory rather than a link, junction, or reparse point. Remove a prior local
generated manifest deliberately before creating another one. The single-use
publication stage is `.local-validation/release-candidate-stage`; it contains
the manifest plus every fixed component at its manifest path. Both locations
are ignored because they are generated evidence. CI retains the uploaded staged
snapshot for 14 days.

The focused offline mutation suite is:

```powershell
npm run test:release
```

The verifier makes no network, DNS, cloud, provider, credential, or transaction
call. For controlled evidence ingestion, import
`loadAndVerifyReleaseManifest(workspaceRoot, manifestPath, expectedRevision)`.
It accepts an explicit bounded regular file, performs strict canonical parsing,
rejects every linked or reparse-point path component, requires two identical
reads through one stable descriptor, rechecks clean `HEAD` and its tree, and
recomputes every component. Only its deeply frozen return value passes
`isVerifiedReleaseManifest`. Consumers must
match a signed evidence bundle's `releaseCandidateManifestSha256` to that
branded value's `payloadSha256`; parsing JSON or comparing an unverified string
is insufficient. Immediately before acting, consumers must call
`revalidateVerifiedReleaseManifest(workspaceRoot, manifest, expectedRevision)`.
It requires the original private brand and physical workspace, repeats the
source and byte checks, and returns the identical object; any failure is the
single sanitized `ReleaseManifestInvalidError`.

Pull requests still build, test, create, and verify a manifest, but never stage
or upload a release-candidate artifact. Publication is restricted to a push or
manual run on `refs/heads/main`, occurs only after the compiled migration and
live infrastructure lanes pass, and uploads no mutable original build path.

The staged archive-chain records bind each captured local Docker ID through its
saved OCI index/manifest/config chain (or the classic config-ID form) to the
exact config embedded by Syft and its ordered rootfs diff IDs. Syft's source and
tag fields corroborate that result but are not its trust root. This is a local
source-image/config/rootfs binding, not registry immutability, scanner truth,
provenance, signature, or approval.

Permission sealing is defense in depth, not an operating-system immutability
boundary. The artifact action reads the stage by path after the final verifier;
a process running as the same OS identity (or with greater privilege) could
restore permissions or substitute a path in that interval. Publication therefore
assumes an isolated, trusted CI job with no untrusted surviving background
process. Every downstream consumer must parse the staged canonical manifest and
recompute every listed size and SHA-256 from the downloaded artifact before it
builds an image or treats the candidate as release input. Closing a hostile
same-user threat model requires a future hardened publisher to create one
exclusive, fsynced archive, bind an independently retained digest to it, and
upload only that archive; the current directory-upload workflow does not make
that claim.

## Remaining external release gates

This manifest is not a signature, SLSA provenance statement, OCI digest,
malware scan, vulnerability disposition, or durable release archive. Its two
contained SPDX documents are package inventories, not scan dispositions. The
uploaded self-contained stage is not itself a production container. CI builds,
locally hardening-checks, and inventories the two reviewed non-root/read-only
application images before manifest creation, but it does not publish or stage
those images. The exact API image is the shared executable artifact for the API,
outbox-worker, and migration task definitions; their task identities and runtime
permissions remain distinct. Before any authorized deployment, the delivery
system must bind immutable OCI digests and
source labels to this exact manifest hash, retain the staged SBOMs, generate
signed provenance, scan the final images, and independently verify the result.
Registry
publication, signing identities, retention policy, deployment health evidence,
rollback exercise, and every public/mainnet approval remain external blockers.
