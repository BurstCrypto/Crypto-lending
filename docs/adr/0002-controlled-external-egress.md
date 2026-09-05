# ADR 0002: Controlled external application egress

- Status: Proposed; no external destination or paid control is approved
- Date: 2026-08-19
- Jira: KAN-231
- Parent: KAN-34
- Decision owners: Application architecture, security, privacy, service owners,
  and finance

## Context

The KAN-34 application baseline deliberately gives its ECS tasks no general
internet route. Private AWS service endpoints can support image pulls, logs,
secrets, and queues, but they do not make a blockchain RPC, identity provider,
oracle, pricing service, or other public vendor reachable. Adding a default
route merely to make those dependencies work would erase that boundary and
would also activate infrastructure with ongoing and usage-based charges.

The application does not yet have an approved destination inventory:

- KAN-34 is the root application-baseline dependency and the inert policy
  example does not claim that it has an approved live decision;
- KAN-37, **Integrate authentication and secure sessions**, has a local
  provider-neutral implementation in review but no managed identity selection;
- KAN-62, **Select RPC and indexing providers**, has a local Alchemy-primary /
  QuickNode-fallback proposal pending KAN-251 independent approval and live
  validation; and
- no hostname, redirect target, provider contract, data flow, credential
  transport, or availability requirement has been approved for KAN-231.

Browser traffic is a separate trust boundary. A wallet SDK or browser RPC call
leaves the user's device and does not traverse the application VPC. A backend
network control therefore cannot govern it. Content Security Policy (CSP),
connector configuration, exact origins, and browser-side observability are
useful complementary controls, but they cannot be counted as server-egress
enforcement.

The current repository configuration supports the interim browser state with a
complete all-route CSP shared by the application and restricted wallet lab.
Production/default behavior keeps connect/default sources same-origin, allows
only same-origin external style/script resources plus the reviewed inline and
`data:`/`blob:` cases, and denies frames, embedding, base changes, and objects. Only explicit
`development` and `test` runtimes add loopback WebSockets and the local
framework evaluation exception. This is a locally inspectable default deny,
not live-header evidence or approval for any provider origin.

This ADR defines the information and approvals that a future decision needs. It
does not approve an AWS design, vendor, subscription, trial, hostname, or cloud
action.

## Proposed decision

### Keep the current interim state at `NO_EXTERNAL_EGRESS`

The only selected state while this ADR is Proposed is
`NO_EXTERNAL_EGRESS`: application workloads have no route to non-AWS public or
vendor endpoints, and the approved destination list is empty. This is a safe
interim posture, not the final architecture and not evidence that an active
application can already use identity, RPC, indexing, oracle, or pricing
services.

`NO_EXTERNAL_EGRESS` does not imply that future AWS service endpoints are free.
An authorized KAN-34 deployment may use narrowly scoped AWS interface and
gateway endpoints for platform operations, and some of those endpoints have
hourly and data-processing charges. No endpoint or other resource is created by
this ADR or by local policy validation.

No application service may work around the interim state with a public IP,
unreviewed NAT path, direct IP address, wildcard hostname, alternate port,
redirect, DNS-over-HTTPS endpoint, embedded proxy, public fallback URL, or
vendor SDK default transport. A dependency that cannot operate within the
selected state stays disabled or causes only its bounded feature to fail
closed.

The local KAN-34 topology validator makes that boundary structural. It permits
only the property-complete, LF-normalized template SHA-256 recorded by the
validator, so any template change requires a visible review-boundary update. It
permits only the public route table's exact Internet-Gateway default route and rejects
private defaults, route propagation, transit/VPN/peering/Cloud WAN/VPC Lattice
paths, NAT/EIPs, firewalls, and proxy compute. API and worker services use only
the backend task security group; web uses only its web task security group; all
remain in the two private subnets with public IPs disabled. The complete
security-group egress graph is limited to the reviewed ALB/backend, PostgreSQL,
Redis, VPC-DNS, interface-endpoint, and S3-prefix-list relationships. These
static assertions do not prove a deployed route table or security group.

### Make every future allow an explicit, reviewable record

A future approved manifest must bind each destination to a service-specific
caller identity. A web server, API task, outbox worker, migration task, and
browser origin are distinct callers. Sharing a broad security group, task role,
proxy credential, or wildcard policy across them is not an acceptable
substitute for that identity.

The policy manifest records, at minimum:

- schema version, policy ID, status, environment, account/Region boundary,
  current mode, ADR status and revision, source commit, separate design-approval
  and final-acceptance times, and review expiry;
- the exact KAN-34, KAN-37, and KAN-62 dependency state and immutable references
  to the decisions that resolve them;
- one destination ID per caller and service, with a concrete KAN dependency and
  decision reference, caller runtime, task role or equivalent principal,
  security-group/proxy identity, service owner, provider owner, business
  purpose, approved data classes, and availability owner;
- exact lowercase DNS hostname, scheme, port, approved API scope, redirect
  policy, DNS behavior, SNI requirement, minimum TLS version, strict system
  trust, hostname verification, and invalid-certificate prohibition;
- credential transport and an opaque `credential-ref:` reference only, with no
  token, password, key, connection string, or private certificate value in the
  record;
- timeout, bounded retry and jitter policy, circuit breaker, degraded behavior,
  outage behavior, fallback rule, and destination- and workload-level kill
  switches;
- allowed log fields, mandatory redacted headers, disabled body/query logging,
  alert ownership, bounded retention, and evidence references that contain no
  secrets or customer payloads;
- per-destination monitoring status, selected metrics, threshold rules, alarm
  references, owner, and a separately approved cost/activation/pricing contract;
- architecture, service-owner, security, privacy, finance, and independent
  design-verifier decisions, including approver identity, UTC decision time,
  scope, expiry, and referenced evidence, plus a separate post-evidence
  `acceptanceVerifier` and `acceptanceDecision`; and
- a cost snapshot with currency, pricing Region, effective and expiry dates,
  fixed monthly charges, usage assumptions, per-unit charges, cross-AZ and
  internet transfer, logging, support/license fees, high-availability
  multipliers, cleanup tail, owner-approved headroom, separate activation
  approval, aggregate architecture envelopes that cover every destination and
  monitoring contract, and KAN-229 billing-control
  record/configuration-digest binding.

`IDENTITY` destinations use KAN-37, while `RPC` and `INDEXING` destinations use
KAN-62. `ORACLE`, `PRICING`, `WALLET_VENDOR`, and `PARTNER_API` destinations
must name a different concrete downstream provider-decision ticket; they may
not reuse KAN-34, KAN-37, KAN-62, or KAN-231. An approved destination binds its exact
dependency decision rather than relying on a ticket status alone.

The local example remains deliberately inert: status `NOT_APPROVED`, current
mode and selected control `NO_EXTERNAL_EGRESS`, an empty destination array,
unapproved KAN-34/KAN-37/KAN-62 dependencies, `architecture.adrStatus`
`NOT_APPROVED`, no KAN-229 binding, and `approvedAt`, `acceptedAt`, `expiresAt`,
and every evidence/hash field `NOT_RUN`. Its `acceptanceVerifier` remains
`NOT_APPROVED` and `acceptanceDecision` remains `NOT_RUN`. This ADR itself
remains Proposed. Canonical and configuration hashes make changes visible, but
a hash is not authorization.

### Separate design approval from runtime acceptance

The semantic validator has four modes:

- `example` validates only the committed inert example. It cannot approve a
  destination.
- `proposed` keeps `NO_EXTERNAL_EGRESS`, cost and activation unapproved,
  KAN-229 binding unset, `approvedAt`/`acceptedAt`/`expiresAt` unset, and all live
  evidence and evidence hashes `NOT_RUN`; only local policy validation may
  mature to `PASS`.
- `approved` means the design, exact destinations, all three root dependencies,
  monitoring, current price windows, aggregate cost envelopes, activation,
  authority, and validated KAN-229 billing-control binding are approved.
  `approvedAt` and independent `verifiedAt` record pre-evidence design approval
  and verification. `acceptedAt` and `acceptanceDecision` stay `NOT_RUN`, while
  `acceptanceVerifier` stays `NOT_APPROVED`; local policy validation is `PASS`,
  but every runtime result/observation/evidence-hash field remains `NOT_RUN`.
  An `APPROVED` record is not runtime acceptance.
- `final` requires policy status `ACCEPTED`, every evidence result `PASS`, an
  `observedAtUtc` no more than seven days old, current cost/review/policy/KAN-229
  expiries, and tested destination kill switches. Design `approvedAt` and
  independent `verifiedAt` are at or before evidence. A separate
  `acceptanceVerifier`, independent of every design role and destination
  implementation owner, records `acceptanceDecision: ACCEPTED`; `acceptedAt`
  is strictly after evidence and both design timestamps. The final evidence hash
  equals the unchanged approved-design configuration digest, and its protected
  reference begins `evidence-index:KAN-231:<hash>:`. Kill-switch tests are no
  more than 90 days old.

The `approved`/`final` CLI requires a regular, non-symlink, outside-repository
final KAN-229 record and validates its exact environment/account/Region,
identity, configuration digest, and expiry locally. The validator checks
reference prefixes, hashes, freshness, and ordering, but cannot prove that the
record's claimed live controls still exist or that an external evidence index
is immutable and access-controlled; those are separately reviewed operational
facts.

The canonical hash covers the complete record. The policy-configuration hash
includes `schemaVersion`, `policyId`, `currentMode`, design
approval/verification/expiry, environment, dependencies, architecture,
destination review state, monitoring/cost contracts, and the KAN-229 binding.
It deliberately omits root lifecycle `status`, `acceptedAt`,
`authority.acceptanceVerifier`, `authority.acceptanceDecision`, runtime
evidence, and destination kill-switch test time/evidence. Therefore an
unchanged approved design keeps the same policy-configuration digest through
post-evidence `ACCEPTED`, while the full canonical digest changes with the
acceptance and evidence fields. Final evidence binds the stable pre-activation
design digest; any included configuration change requires a new approval and
digest.

Only the inert example belongs in the repository. Every Proposed, approved, or
final operational policy and its protected evidence index stays outside the
repository. Final local validation requires both that protected index and an
independently supplied expected configuration digest. The validator performs
strict cross-artifact consistency checks; it does not create a cryptographic
signature, replace protected storage, or replace independent review. The
current repository has no operational record, no approved destination, and no
live KAN-231 evidence.

Every non-example CLI validation requires exact `--expected-environment`,
`--expected-account`, `--expected-region`, and `--expected-source-revision`
inputs. `approved` and `final` additionally require
`--billing-control-record`; `final` alone requires `--evidence-index-record`
and `--expected-policy-configuration-sha256`. Earlier modes reject those final
arguments. Policy, billing-record, evidence-index, and optional
`--browser-egress-source` inputs must be regular, non-symlink local files.
UNC/device and URI paths are denied.
Policy, billing-record, and evidence-index bytes must also be strict UTF-8 JSON
without a byte-order mark or duplicate object keys at any depth. A matching
independent configuration digest cannot make a last-key-wins ambiguous record
eligible for validation.

### Enforce DNS, TLS, and redirects as part of the allow

Every future destination is HTTPS or WSS on port 443. Hostnames are exact;
wildcards, URL user information, query-string credentials, IP literals,
loopback/link-local addresses, unapproved private answers, and unreviewed
alternate endpoints are denied. A selected `PRIVATE_ENDPOINTS` design may allow
only its explicitly approved private-endpoint answer and exact
`vpc-endpoint:` control reference.

DNS resolution must use the selected VPC resolver path and its logs must not
capture secrets. The implementation must define how it detects unexpected
private, loopback, link-local, cross-environment, or provider-shared answers and
how it responds to rebinding, lookup failure, answer changes, and expired
caches. An IP/CIDR allowlist alone cannot establish vendor identity because
provider addresses are mutable and often shared.

TLS must validate the system trust chain, certificate validity, and hostname
against the exact SNI name with TLS 1.2 or newer. Certificate verification is
never disabled for availability. TLS interception is off unless a separately
approved threat model, trust-store lifecycle, privacy assessment, and failure
test justify it. Redirect following is off by default; if a service requires a
redirect, its target is a second approved destination preserving scheme/port,
the complete execution identity/network control, service, dependency
ticket/decision, data, credential reference, TLS, DNS, and API scope.
Credentials are never forwarded, and protocol downgrade, alternate ports,
unlisted targets, and redirect cycles are denied.

### Fail closed and retain an immediate kill switch

An unavailable dependency must produce a bounded, documented result: disable
the dependent feature, return a clear retryable error, serve explicitly stale
non-sensitive data within an approved age, or stop the affected worker. It must
not fall back to an unlisted public RPC, identity endpoint, oracle, IP address,
or SDK default. `USE_APPROVED_ALTERNATE` is permitted only when the other
destination is explicitly listed and approved and preserves the same complete
constraints as a redirect target. Service borrowing, missing alternates,
fallback-only cycles, and cycles that combine redirect and fallback edges are
denied.

Requests use bounded connection/request timeouts, at most five attempts with
exponential jitter, no retry of non-idempotent requests, and a fail-closed
circuit breaker so that a provider outage cannot exhaust the application.
Operators need kill switches for a single destination/caller and all external
application egress. The default and rollback state is deny. Re-enabling a path
requires the same manifest and configuration hashes that were approved.

### Log decisions, not secrets

The manifest permits only an approved subset of `destinationId`, `outcome`,
`durationMs`, `statusClass`, `retryCount`, and `circuitState`. Body and query
logging are disabled, and secret fields are dropped and redacted. The redacted
header list includes at least `authorization`, `proxy-authorization`, `cookie`,
`set-cookie`, and `x-api-key`. Retention is bounded to 1–90 days and has an
explicit alert owner.

Logging configuration still needs least-privilege access, redaction tests,
volume and ingestion-cost assumptions, and alerts for denied attempts and
kill-switch use. It must not record signed wallet messages, session identifiers,
secret references, customer addresses, or request/response payloads.
Observability must not become a second data-exfiltration path.

The policy also recursively rejects private keys, AWS/Slack/GitHub/OpenAI
tokens, JWTs, bearer values, secret assignments, credentials embedded in URIs,
email addresses, literal EVM addresses, SSNs, and phone numbers. Public
IP-shaped values are rejected in narrative/reference fields while exact
structured endpoint validation handles address fields. People and secret values are not
approver IDs or Jira evidence; records use non-personal role aliases and opaque
references instead.

### Make monitoring explicit and priced

Each destination selects 1–6 reviewed metrics from request, failure, latency,
denial, circuit-breaker, and kill-switch signals. Its 1–12 unique alert rules
cover every selected metric with a comparison, threshold, evaluation count,
supported period, missing-data behavior, and—after approval—an exact
`alarm-ref:` reference. The monitoring contract has its own owner, status, and
fixed/variable/ceiling cost, activation decision, finance reference, and price
window. A Proposed record keeps monitoring and its cost unapproved; approved
and final records require both to be approved.

## Options considered

No future option in this table is selected or authorized. Prices must be
refreshed for the approved account, Region, traffic, availability design, and
vendor contract before a decision.

The current manifest can select only `BROWSER_APPLICATION_CONTROLS_ONLY`,
`PRIVATE_ENDPOINTS`, `EGRESS_PROXY_WITH_NAT`, or
`NETWORK_FIREWALL_WITH_NAT` after leaving `NO_EXTERNAL_EGRESS`. Selecting a
self-managed appliance or third-party service would first require an explicit
ADR, schema, validator, security/privacy, and cost revision; it cannot be
smuggled in under another control name.

| Option                                         | Security and operational properties                                                                                                                                                                                                                                                                                                                                      | Cost model and current disposition                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-supported AWS PrivateLink             | Avoids a general internet route and can bind endpoint policies, security groups, private DNS, and service-specific callers. Availability, Region coverage, DNS ownership, cross-AZ behavior, and vendor support must be verified.                                                                                                                                        | Interface-endpoint AZ-hours and bytes, provider endpoint fees, cross-AZ traffic, DNS/logging, and possible vendor-plan charges. Evaluate per approved service; not selected.                                                                |
| Explicit egress proxy plus NAT                 | A proxy can enforce exact HTTP host/SNI and caller policy while NAT supplies upstream reachability. It requires hardened identities, HA, patching, DNS controls, bypass prevention, and a decision against silent TLS interception.                                                                                                                                      | NAT gateway hours/bytes, proxy compute or load balancer, cross-AZ paths, logs, operations, and internet transfer. Not selected.                                                                                                             |
| AWS Network Firewall plus NAT and DNS Firewall | Offers layered network, domain, and flow controls, but L3/L4 inspection does not by itself prove an HTTP service identity. Rule lifecycle, symmetric routing, log redaction, fail behavior, and capacity need careful design.                                                                                                                                            | Firewall endpoint hours/GB, NAT hours/GB, Route 53 Resolver DNS Firewall/query/log charges where applicable, cross-AZ traffic, and operations. Likely high fixed non-production cost; not selected.                                         |
| NAT gateway with destination CIDRs             | Simple routing, but dynamic and shared provider addresses make CIDRs brittle and over-broad. It cannot safely constrain HTTP host, redirects, SDK fallback, or another tenant on the same address.                                                                                                                                                                       | NAT hours/bytes, data transfer, change monitoring, and operational churn. Rejected as the authorization control.                                                                                                                            |
| Self-managed proxy, NAT, or firewall appliance | Can provide customized L7 policy and identity mapping, but introduces image provenance, patching, capacity, HA, failover, privileged-network, and incident-response burdens.                                                                                                                                                                                             | Compute, disks, load balancers, licenses, logging, data transfer, standby capacity, and engineering/on-call time. Not selected.                                                                                                             |
| Third-party secure egress service              | May provide managed identity, domain policy, telemetry, and multi-cloud controls. It adds a new processor and availability dependency, and requires contract, DPA, residency, credential, telemetry, exit, and agent/tunnel review.                                                                                                                                      | Subscription/minimum commitment, seats or connectors, data volume, private connectivity, logs, support, and exit costs. No trial or plan is authorized; not selected.                                                                       |
| Browser CSP and exact SDK/origin configuration | The current composed policy denies external production/default connections, scripts, styles, images, fonts, media, frames, workers, manifests, forms, and objects except its explicit same-origin/inline/data/blob cases. A future allow would require an exact policy revision. Extensions retain their own privileges, and browser traffic never crosses VPC controls. | Usually no separate network service fee; header maintenance, reporting ingestion, and vendor SDK/service costs still apply. The current local default deny remains in place; no external origin or future browser architecture is approved. |

## Cost and authorization model

Each option must be estimated as a lifecycle, not a single line item:

1. fixed recurring charges, including endpoints per AZ, gateways, firewall
   endpoints, proxy capacity, load balancers, vendor minimums, support, and
   licenses;
2. usage charges for processed bytes, requests, queries, log ingestion and
   storage, metrics, cross-AZ transfer, internet transfer, and provider APIs;
3. one-time engineering, security, privacy/legal, procurement, migration, and
   load/failure-testing effort;
4. high-availability and burst headroom plus retry amplification during an
   outage; and
5. cleanup and retained-data costs after disablement or rollback.

The estimate records low, expected, and stress volumes, a UTC price date and
short expiry, exclusions, taxes/support assumptions, and current public versus
contract pricing sources. Finance approves a maximum recurring baseline and
usage envelope before a cloud Plan, vendor signup, free trial, Marketplace
purchase, subscription, or activation. Cost approval and activation approval
are separate fields. An approved operational policy also binds
`billingControlRecordReference` to the reviewed, unexpired KAN-229 record and
`billingControlConfigurationSha256` to its exact configuration digest. Local
CLI validation reads and validates the exact outside-repository KAN-229 file; it
does not contact AWS or prove current cloud state. A nominal `$0` offer or free
tier is not permission to activate it.

The architecture fixed/variable/ceiling envelopes must each cover the aggregate
of every destination and monitoring contract. Policy expiry cannot outlive the
architecture price window, any destination review, destination or monitoring
price window, or validated KAN-229 record. Passing these arithmetic and expiry
checks is not cost or activation approval.

Repository-local editing, schema validation, static topology checks, and
synthetic tests create no resource and have an incremental cloud-service cost
of `$0`. That statement does not estimate developer time and does not assert
that a future runtime architecture is free.

## Approval and re-review

Architecture, destination, cost, and activation approval may produce an
`approved`-mode operational record, but that record deliberately retains live
evidence as `NOT_RUN`. Changing this ADR to Accepted and the policy to
`ACCEPTED` requires the later `final` evidence, a separately independent
`acceptanceVerifier`, `acceptanceDecision: ACCEPTED`, and post-evidence
`acceptedAt`. Design `approvedAt` and independent `verifiedAt` are preserved at
or before the evidence observation. Relevant service owners, architecture,
security, privacy, and finance owners must approve their scopes. The design
verifier is independent of every approval and destination-owner role; the
acceptance verifier is also independent of those implementation roles and all
design approval/verification roles. If both founders participate in the
implementation, the independent reviewers must be qualified third parties who
did not implement the change. The decision record includes UTC times, scope,
evidence, exceptions, and expiry; a Jira transition or Git merge alone is not
approval.

Re-review is mandatory at the recorded expiry and before any provider, host,
port, protocol, Region, account, caller, task role, security group, proxy,
certificate policy, redirect, SDK default, data class, logging field, price,
monitoring metric/rule/alarm, contract, or fallback change. Emergency
disablement does not require approval; re-enablement does.

## Separately authorized implementation sequence

1. Approve the exact KAN-34 baseline decision, and complete KAN-37 and KAN-62
   provider decisions with exact hosts, flows, credentials, data classes,
   owners, availability, and contract terms. Keep the destination list empty
   until then.
2. Inventory each caller/destination pair and complete the security, privacy,
   dependency-decision, DNS, TLS, redirect, failure, logging, monitoring,
   rollback, and destination/monitoring cost fields. Add separate downstream
   KAN provider decisions for oracle, pricing, wallet-vendor, or partner-API
   destinations.
3. Refresh costs and compare the viable options under low, expected, outage,
   and stress traffic. Ensure the architecture envelope covers all destination
   and monitoring costs. Obtain architecture, service-owner, security, privacy,
   finance, activation, and independent review; record design `approvedAt` and
   `verifiedAt` before runtime evidence. Keep the separate
   `acceptanceVerifier`/`acceptanceDecision` fields unapproved and `NOT_RUN`.
4. Bind the outside-repository operational policy to the reviewed, unexpired
   KAN-229 billing-control record and configuration SHA-256. Validate the exact
   source/account/Region/design in `approved` mode: local validation is `PASS`,
   while every runtime result and observation remains `NOT_RUN`. Record any
   exception explicitly; do not call this live acceptance.
5. In a separate ticket and branch, implement only the approved controls as
   reviewed IaC and application configuration. Local linting and synthetic
   tests happen before any account call.
6. Under a separate cloud authorization, review a cost-bound plan before
   creating resources. A plan, vendor account, trial, or subscription is not
   implied by this ADR.
7. In an approved non-production window, test each intended caller/host allow,
   unlisted-host deny, DNS failure and answer change, TLS and redirect failure,
   vendor outage, timeout/retry/circuit behavior, redaction, alarms, and all
   kill switches. Record redacted UTC evidence and actual resource IDs/cost
   signals.
8. Store the protected evidence index outside the repository. After every
   evidence result is `PASS`, record a current observation time. Bind
   `evidence.policyConfigurationSha256` and the
   `evidence-index:KAN-231:<hash>:` prefix to the unchanged approved-design
   digest, and cross-check the protected index against an independently
   supplied expected configuration digest. A separate verifier who is independent of design and implementation
   roles then records `acceptanceDecision: ACCEPTED`; record post-evidence
   `acceptedAt` and validate the final `ACCEPTED` record in `final` mode. The
   full canonical digest changes, while the policy-configuration digest stays
   bound to the pre-activation design.
9. Roll back or clean up as authorized, re-estimate, and re-review before
   production. Do not infer production approval from a non-production pass.

## Evidence boundary and acceptance gates

Local checks can validate manifest structure and semantics, deterministic hash
bindings, default-deny topology, exact route/security-group relationships, and
synthetic allow/deny or failure cases. They cannot prove provider reachability,
DNS answers, TLS chains, runtime task identity, log delivery/redaction,
kill-switch propagation, AWS resource state, availability, or cost.

This Proposed ADR records no live execution. AWS API calls, DNS lookups, TLS
connections, provider requests, resource creation, vendor signup, trial
activation, and paid-service activation are all **Not Run**. Local results must
be reported separately from live results; a green local validator never changes
a live item from **Not Run** to Pass.

Before this ADR can become Accepted, all of the following must be true:

1. KAN-34, KAN-37, and KAN-62 are resolved with reviewed decision references
   and exact destinations.
2. The operational policy is outside the repository, unexpired, secret-free,
   and bound to the exact account, Region, source revision, dependency
   decisions, selected design, and configuration hash.
3. Cost and activation approvals cover aggregate architecture, destination,
   monitoring, usage, log, transfer, subscription, failure-amplification, and
   cleanup costs. All price/review expiries and the validated KAN-229
   record/configuration digest bound the policy lifetime.
4. Selected IaC and application controls pass independent local and security
   review without a broad bypass.
5. Separately authorized non-production evidence records `PASS` for local policy
   validation, intended-service allow, unlisted-service deny, provider outage,
   DNS failure, TLS failure, log redaction, and the kill switch.
6. The final observation is no more than seven days old,
   `evidence.policyConfigurationSha256` equals the unchanged approved-design
   digest, its protected reference starts
   `evidence-index:KAN-231:<hash>:`, and every destination kill switch passed a
   test within 90 days.
7. Design approval and independent verification precede the evidence
   observation. A separately independent `acceptanceVerifier` records
   `acceptanceDecision: ACCEPTED`, and final `acceptedAt` follows the evidence
   and both design times. The `ACCEPTED` record preserves the approved
   configuration digest while its full canonical digest covers the acceptance
   and evidence fields.
8. Any exception is explicit, owned, narrow, time-bounded, and separately
   approved.
