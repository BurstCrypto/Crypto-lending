# Dormant provider-position admission and assembly boundary

Status: dormant, unregistered, read-only, and non-persistable.

## What the coordinator establishes

`DormantProviderPositionAdmissionCoordinator` is an application boundary between independently implemented provider/account readers and the existing mainnet provider-position coverage domain. For every authoritative active wallet × approved provider market, it:

1. Parses the caller-supplied approved observation policy with the existing policy parser and requires its separately supplied exact fingerprint.
2. Reads the authoritative active-wallet roster through the existing portfolio wallet port inside the same absolute-deadline runner used by later work, then parses it with `parseActivePortfolioWalletRegistrations`.
3. Derives the same wallet × market target product used by the coverage domain, using only active registry assets and policy-approved market attribution.
4. Requires one configured binding for every policy source and at least two distinct `sourceFamilyId` values for every active target's network.
5. Sends every source an account-, correlation-, deadline-, abort-signal-, wallet-, network-, provider-, protocol-, market-, and asset-bound request.
6. Accepts only exact, bounded, descriptor-safe plain-data responses marked `COMPLETE`; it rejects missing/extra fields, unknown assets, duplicate positions, malformed integers, stale evidence, and continuity-floor regressions.
7. Requires every independent source to report the exact same canonical position set and atomic balances. It never substitutes a missing response with zero. An empty set is admitted only when every required independent source explicitly and currently reports that complete empty set.
8. Canonically orders targets, positions, and source evidence, then produces deterministic SHA-256 fingerprints and a valid `MainnetProviderPositionCoverageManifestV1` with `COMPLETE` / `AGREED` targets.

Concurrency is bounded by a validated maximum of eight. The wallet-roster,
provider-source, and trusted-assembly runner invocations share one `AbortSignal`
and one exclusive server-authored deadline; every provider request receives that
exact signal. The first parallel source failure aborts it immediately, prevents
queued work from starting, and drains already-started cooperative reads before
the coordinator settles. The signal is also aborted on every failed preparation
and after either successful terminal path; it remains live through final trusted
assembly verification. The returned candidate and covered snapshot expose no
controller or signal.

Deadline enforcement remains delegated to an injected runner. A concrete Node
implementation now exists as dormant infrastructure source only. It accepts an
exclusive deadline no more than 30 seconds ahead, schedules one unreferenced
timer, invokes the coordinator's narrow admission-abort authority on deadline or
operation failure, rechecks the clock after physical settlement, and removes its
timer and abort listener on every exit. It returns only fixed, sanitized failure
codes and has no network, environment, decorator, provider, persistence, or
financial capability.

The runner deliberately awaits an already-started operation after signaling
abort; it cannot make a non-cooperative promise settle. Production provider
transports must stop and settle on the supplied signal and retain their own
lower-level transport bounds. The coordinator now also passes the exact shared
signal through the optional portfolio wallet-reader request, the registered
reader, wallet service and repository port, and the PostgreSQL wallet
repository. The adapter and repository each capture it once to prevent
repeated-read/TOCTOU substitution. The signaled branch calls
`PostgresService.queryWithCancellation`; the legacy unsigned portfolio branch
still calls the ordinary query path. Neither
branch uses `Promise.race`, creates a replacement signal, or falls back from a
failed cancellable query.

`PostgresService` rechecks cancellation after acquiring its dedicated client,
then drains query settlement and discarded-client teardown before returning.
Active `pg` pool acquisition has no native signal cancellation, however, so
acquisition and the required drain can extend past the logical admission
deadline. A production `connectionTimeoutMs` must be no greater than the
configured admission bound. These local contracts establish propagation and
drain behavior, not a hard latency or deployed-configuration guarantee.

The coordinator owns no endpoint, environment lookup, network client, credentials, database, persistence port, writer, or financial-action capability.

## Why `admit` does not emit `MainnetProviderPositionSnapshotV1`

The existing snapshot parser correctly requires a `MainnetProviderPositionChainAssessmentV1` and an opaque trusted verifier capability. Verification is bound to all normalized observation fields, including:

- the final snapshot ID;
- observation ID and fingerprint;
- wallet/provider/protocol/market/position attribution;
- selected source identity and observation ID;
- exact chain anchor and balance;
- observed, captured, evaluated, assessed, and stale timestamps; and
- policy and asset-registry fingerprints.

Independent source results arrive before those final assembly choices exist. Their capabilities cannot safely be merged, copied, or reconstructed by this coordinator. Doing so would either bypass the existing verifier or falsely claim trusted chain identity/progression/finality.

The output therefore has:

- `mayAuthorizeFinancialAction: false`;
- `mayPersist: false`;
- `mayCreatePositionSnapshot: false`; and
- `assemblyStatus: BLOCKED_PENDING_TRUSTED_CHAIN_ASSESSMENT_ASSEMBLY`.

It contains a deterministic proposed snapshot ID, agreed normalized positions, accepted source evidence, and a parsed coverage manifest, but it is not itself a provider-position snapshot.

## Dormant trusted assembly boundary

The optional `ProviderPositionTrustedChainAssessmentAssemblyPort` closes the in-process assembly contract without supplying a production implementation. It is constructor-injected and is not exported by the feature barrel, registered in the Nest module, or reachable from an HTTP endpoint. `admitAndAssemble` fails with the sanitized `ASSEMBLY_UNAVAILABLE` code before reading wallets or providers when that port is absent.

When the port is present, the coordinator retains the same-cycle authoritative wallet roster and parsed policy rather than rereading or reconstructing either one. It deterministically selects the first canonically ordered accepted independent source for every agreed target position and builds immutable observation input. The assembly request binds:

- the complete admission candidate and its fingerprint;
- the coverage-manifest fingerprint;
- account, correlation, snapshot, policy, and asset-registry identities;
- every selected position, balance, source observation, chain anchor, and evidence timestamp;
- a server-authored evaluation time and exclusive deadline; and
- the same abort signal used by the bounded admission operation.

One server-side port instance must issue the assessment, verify the whole assembly request, and verify every normalized nonempty observation. Its exact returned object is passed unchanged as the opaque verifier capability; a structurally identical clone or deserialized object is not sufficient. The port cannot return a verifier, approval boolean, writer, persistence handle, or final snapshot. The existing coverage and snapshot parsers remain the only path to the returned covered snapshot.

The returned read-only envelope retains the original blocked admission candidate and exposes neither the raw assessment nor its capability. It explicitly has `mayAuthorizeFinancialAction: false` and `mayPersist: false`. For every target, including a zero-position target, the request separately carries the canonical selected source and anchor. An independently agreed empty position set invokes whole-assembly verification before using the coverage parser's explicit empty-snapshot path; it does not fabricate an observation or anchor.

Assembly shares the admission deadline, captures the port's methods once without invoking accessors, is rejected if the server clock regresses or reaches the exclusive deadline or evidence-expiry boundary before or after verification, and aborts the shared signal when the operation finishes. A failed port, counterfeit capability, missing or extra assessment entry, changed source/anchor, or parser rejection returns no partial snapshot and is sanitized to `ASSEMBLY_UNAVAILABLE`.

## Required production binding

Production still needs a reviewed implementation of the dormant port. It must independently verify every selected anchor against durable chain identity, progression, and finality state and issue one object-identity capability covering the complete assembled assessment. A private dormant runtime composition now consumes one reviewed lazy PostgreSQL pool and its exact admission options through the wallet-roster, deadline-runner, and coordinator graph, but no trusted assessment implementation or registered production composition exists. Therefore, `admitAndAssemble` is not a live application path.

The offline production preflight now byte-pins this coordinator, assembly port,
concrete deadline runner, complete wallet-roster cancellation chain, shared
PostgreSQL cancellation service, runtime-budget resource, and private dormant
composition with a selected twenty-one-file
reader/domain/infrastructure/module/barrel/controller critical-source slice.
Its local check rejects trust, timing, source-method substitution, active-controller
lifecycle, signal substitution, cancellation/drain/cleanup, query fallback,
budget/configuration substitution, zero-target anchor, authority, or
feature-surface drift inside that slice, but deliberately reports the reader,
trusted-assessment, and deadline-runner feature registrations as missing. It
does not prove recursive dependency closure or scan every application module,
and it performs no provider, chain, network, cloud, secret, transaction, or
billable operation.

That production change must also provide:

- reviewed policy bindings with two genuinely independent operators/source families per active Ethereum and Solana target;
- live source implementations that enforce account and wallet ownership boundaries;
- transport-level timeouts, cancellation, authentication, and observability;
- durable continuity floors rather than accepting an upstream service's unsupported history claim;
- disagreement quarantine and operator alerting;
- retention/replay rules for source observation IDs; and
- explicit persistence and display approval after live conformance tests.

Until those gates are satisfied, the coordinator and its candidate must remain unregistered and must not be used to imply an available balance, recommendation, or permission to move funds.
