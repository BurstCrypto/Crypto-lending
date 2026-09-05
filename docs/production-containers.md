# Production container contract

The repository now has separate, reproducible production image definitions:

- Dockerfile.api builds the Nest API image. The same image is used with the ECS
  command overrides for the outbox worker and one-off database migration.
- Dockerfile.web builds only the Next.js standalone server and static assets.

Both final images run as UID/GID 10001:10001, clear the shell entrypoint
inherited from the official Node image, use an exec-form Node command, remove
npm, Corepack, and Yarn from the runtime layer, expose only their application
port, and work with a read-only root filesystem. HOME and TMPDIR point to /tmp;
neither process needed a writable path during the local read-only smoke. A
platform may mount a small noexec,nosuid,nodev tmpfs at /tmp if future
instrumentation needs temporary files.

No secret or application configuration is a build argument. Authentication,
database, Redis, queue, RPC, and wallet values remain runtime-only ECS
injections.

## Pinned inputs

The build stages and final stages use the official Docker Library
node:24.20.0-bookworm-slim multi-platform OCI index pinned to:

    sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e

Running docker buildx imagetools inspect node:24.20.0-bookworm-slim on
2026-09-04 reported that index from Docker Hub with Linux amd64 and arm64/v8
manifests. The Dockerfiles do not set --platform, TARGETARCH, or an
architecture-specific package source. Release automation must re-resolve the
human-readable tag from the official registry and independently confirm the
reviewed index digest before intentionally changing it.

The image build installs and verifies the repository-declared npm@11.6.4, then
uses npm ci against package-lock.json with lifecycle scripts disabled. OCI
metadata is isolated in a separate stage so changing a release revision or
timestamp cannot invalidate dependency/build layers. Defaults are deliberately
fail-closed: an all-zero revision and the 1970 timestamp are rejected. Every
build must explicitly supply:

- OCI_SOURCE=https://github.com/Trey-Gleason/Crypto-lending;
- a lowercase, nonzero, 40-character OCI_REVISION; and
- an exact whole-second UTC OCI_CREATED, such as 2026-09-04T12:00:00Z.

BuildKit's SOURCE_DATE_EPOCH input is declared and locked to 0. This normalizes
the image configuration and layer timestamps independently of wall-clock build
time; the reviewed OCI_CREATED label remains the release timestamp. The
metadata stage rejects an attempted SOURCE_DATE_EPOCH override, and the final
image depends on that validation marker.

The API image includes the AWS RDS global trust bundle at the CloudFormation
default path /etc/ssl/certs/aws-rds-global-bundle.pem. Its checked-in source is
the public AWS bundle retrieved from
https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem, last modified
by the source on 2025-07-24. The reviewed file contains 108 parseable
certificates and is pinned by:

    e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3

The build never downloads that mutable URL. Updating the bundle requires a
separate reviewed change to the certificate, sidecar digest, validator, and
this record after checking AWS's current certificate guidance and validity
windows.

## Local validation and builds

These checks are offline and make no Docker or cloud API calls:

    node infra/containers/validate-production-containers.mjs
    node --test infra/containers/validate-built-runtime.test.mjs infra/containers/validate-production-containers.test.mjs

The in-build runtime validator rejects symbolic, hard, and reparse links and
requires every inspected file and directory to remain stable while the tree is
read. Its fixed ceilings are 16 MiB per file, 64 MiB in aggregate, 4,096 files,
8,192 total entries, and 64 path levels. The web standalone manifest must be
the exact canonical `name`/`private`/`version` document written by the reviewed
Docker step; duplicate keys, invalid UTF-8, a byte-order mark, or serialization
drift fail closed. Empty runtime shims remain valid and count toward the file
and entry limits.

For a local single-platform build, use explicit non-production metadata:

    docker build --file Dockerfile.api --tag crypto-lending-api:container-validation --build-arg OCI_SOURCE=https://github.com/Trey-Gleason/Crypto-lending --build-arg OCI_REVISION=1111111111111111111111111111111111111111 --build-arg OCI_CREATED=2026-09-04T12:00:00Z .
    docker build --file Dockerfile.web --tag crypto-lending-web:container-validation --build-arg OCI_SOURCE=https://github.com/Trey-Gleason/Crypto-lending --build-arg OCI_REVISION=1111111111111111111111111111111111111111 --build-arg OCI_CREATED=2026-09-04T12:00:00Z .

The API build removes local-demo and public-testnet compiled modules, prunes
development dependencies, then loads the compiled production AppModule. It
fails if @solana/web3.js, jayson, or stream-json resolves in the runtime graph.
The web build reduces its copied package manifest to name/version/private
metadata and recursively rejects those package directories and module markers
from the standalone tree. Shared UI strings containing public-testnet are not
treated as SDK code.

Local runtime acceptance uses --network none, --read-only, --cap-drop ALL, and
--security-opt no-new-privileges:true. Probe the health endpoint from a second
Node process inside the container over loopback; do not publish a host port.
The API smoke still needs syntactically valid production runtime configuration,
but no dependency endpoint is contacted by its process-health route.

## Controlled multi-platform release handoff

A future authorized release job should perform the following in a clean,
manifest-verified checkout:

1. Run the offline validator/tests and confirm the source revision has not
   changed.
2. Supply the release manifest's exact revision and deterministic UTC creation
   time as build arguments.
3. Build both linux/amd64 and linux/arm64 with a trusted BuildKit builder,
   emitting an OCI layout plus maximal provenance and SBOM attestations. Do not
   use a mutable tag as deployment identity.
4. Generate and retain an SPDX JSON SBOM for each final platform image. A local
   diagnostic can use docker sbom --format spdx-json IMAGE into an ignored
   temporary directory; release evidence must use the approved, pinned SBOM
   producer and bind its digest.
5. Scan each platform manifest and the index by digest with the approved,
   version-pinned scanner. Record the vulnerability database timestamp, policy,
   findings, exceptions, and independent disposition; a successful build is
   not a vulnerability approval.
6. Push only after the target private registry, AWS account/Region, repository,
   retention policy, and spend are authorized. Verify the returned registry
   index and platform digests.
7. Sign the immutable index digests and attach provenance/SBOM attestations
   under the approved signing identity and transparency/verification policy.
8. Bind the verified API, web, worker, and migration image digests into the
   deployment target and release evidence. The worker and migration tasks may
   share the API image digest but retain distinct task-definition identities.

Repository work does not authorize or perform registry login, push, signing,
cloud deployment, or mainnet writes. Remaining external blockers are the
approved registry/repositories, build service and identity, signing and
verification policy, vulnerability policy/exception owners, SBOM retention,
an independent current RDS trust-bundle review, and live ECS startup/dependency
evidence against the exact deployed digests.
