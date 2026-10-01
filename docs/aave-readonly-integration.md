# Aave V3 Ethereum read-only connection

Update, 2026-09-09: the [local Aave browser tool](../tools/local-aave/README.md)
now reads real finalized Ethereum USDC/USDT markets and public wallet balances
through two public RPC endpoints. It runs on `http://127.0.0.1:3300` without AWS,
RPC credentials or a database. This is a development lookup, separate from the
account-owned production position path described below. Production provider
activation and transactions remain outstanding. The validation record below
describes the September 8 checkpoint; the local tool runbook records the update.

Status, 2026-09-08: private connection code implemented and tested locally.
Aave is not live in the application. The directory still has ten planned
providers, zero providers with live-read evidence, and zero with transaction
evidence. This work starts the first provider connection; it does not complete
the ten-provider rollout.

## Implemented path

`createPostgresAaveV3EthereumPositionSource` constructs the existing PostgreSQL
wallet resolver and balance-checkpoint reader, the new durable context reader,
the new HTTPS RPC transcript reader, and the existing Aave position parser.
Construction performs no I/O. This factory is private to direct imports and is
not registered in Nest, a worker, a CLI, a controller, or a feature barrel.

The context reader resolves an active wallet owned by the requested account,
loads that wallet's current Ethereum balance checkpoint, and resolves ownership
again before returning. It requires a retained finalized block number and hash;
an empty database cannot bootstrap this floor from a caller's or RPC's assertion.
It reuses existing database read functions and needs their existing grants plus
metadata decryption configuration. It creates no database authority or records.

For each configured source, the transcript reader performs this bounded sequence:

1. Check Ethereum chain ID and fetch the finalized block.
2. Recheck the retained checkpoint block's canonical number and hash.
3. Read Aave's reserve token addresses and compare them with the fixed manifest.
4. Read aToken supply and variable-debt balances for the requested USDC/USDT
   assets at the same block hash.
5. Reread the selected block by number and check chain ID again.

Two assets require eleven RPC calls per source; one asset requires eight.
Contract reads use `blockHash` and `requireCanonical: true`, as specified by
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). Reserve discovery follows
[Aave's view-contract interface](https://aave.com/docs/aave-v3/smart-contracts/view-contracts).
Only this closed read plan is accepted. Wrong-chain, changed-reserve, regressing,
reorganized, stalled, incomplete, malformed, or conflicting results are rejected.

Each read has a caller deadline capped at thirty seconds. RPC responses share a
one-MiB aggregate HTTP body budget, enforced before JSON parsing. This budget
includes whitespace and UTF-8 bytes. It is separate from the 64-KiB maximum
compact transcript: block replies include transaction hashes even when full
transactions are disabled. The HTTPS transport retains public-address DNS
validation, pinned TLS connections, strict HTTP framing, duplicate-JSON-key
rejection, sanitized errors, and cancellation with accepted I/O drained.

Context and transcript proofs are bound to their issuing instance and the exact
request object. Expired, mutated, aborted, cloned, or clock-regressed proofs do
not pass verification. The existing source and admission layers still own
deployment checks and independent-source agreement.

The combined component tests exercise context reads, RPC transcripts, position
parsing, and the real two-source admission coordinator. Agreeing sources produce
an admission candidate; differing balances produce `DIVERGENT_EVIDENCE`. These
tests also exposed shared asset objects in the old Aave parser that the admission
layer rejected. Each position now receives its own immutable asset value.

An admitted candidate still has `mayCreatePositionSnapshot: false` and
`mayAuthorizeFinancialAction: false`. Durable chain assessment and trusted
portfolio assembly remain necessary before the application can expose positions.

## Repository validation

The provider inventory pins the exact two new connection sources and their
specifications. Unreviewed runtime imports or changed bytes fail validation.
The production preflight also pins the changed Aave parser and HTTPS transport,
including the new response-byte bounds. Its reviewed whole-API source/build
snapshot now contains 426 runtime files and 7,484,942 source bytes, with SHA-256
`05be95196a5266d9889b025c6a589386e63a10755be6b63387e9a6ceae9fb4ff`.
This is a source snapshot, not an image digest or deployed attestation.

Validation logs are retained locally under
`.local-validation/aave-readonly-integration-20260908/` (not committed).
The API unit suite passed 5,389 tests across 300 suites. The production-preflight
suite passed 136 tests with one Windows filesystem skip. Provider validation
tests passed 96 with three Windows filesystem skips. API build, API and preflight
type checks, API/preflight/infrastructure lint, and offline infrastructure
validation passed. After the dependency updates, all 820 web tests and all 71 API
HTTP end-to-end tests passed. A clean Linux install passed all 221 focused
Aave/HTTPS tests, all 137 preflight tests, and all 99 provider-validator tests
without skips; its production web build also passed.
After the final development-dependency patch, a second clean Linux install
passed the complete 5,389-test API suite, API build, full repository lint, and
all 137 preflight tests. Production dependency audits passed on both platforms.

These are local tests using wallet/checkpoint ports and synthetic RPC replies.
The concrete PostgreSQL composition was checked for configuration and no I/O on
construction; no deployed database or live RPC round trip was exercised here.
Existing PostgreSQL adapter tests also ran in the API unit suite.

The launch preflight still exits with `BLOCKED`. Its live-read and mainnet-write
checks fail because live evidence and exposed capabilities are absent. Source
validation does not remove those launch requirements.

## Dependency security follow-up

The fresh production dependency audit initially reported six affected packages
(five high, one critical), including transitive Nest findings. The lockfile now
resolves Next.js and its ESLint configuration to 16.3.4, sharp to 0.35.4, and
Multer to 2.3.0. `npm run security:audit` reports zero production vulnerabilities
after these changes. This is dependency advisory coverage, not a penetration
test or proof that all application vulnerabilities are absent.

The full development-tool audit also found a high-severity js-yaml issue. The
two affected copies were updated to 3.15.2 and 4.3.2, following the
[maintainer's advisory](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh).
The full audit now has zero high/critical findings and six moderate findings
confined to development dependencies: the Solana test SDK's jayson/stream-json/
uuid chain and Hardhat's adm-zip chain. npm's proposed fixes for those findings
would downgrade the SDK or Hardhat; those toolchains remain pinned pending a
compatible, separately tested remediation. They are not production dependencies.

The patched versions follow the maintainers' advisories for
[Next.js](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36),
[sharp](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), and
[Multer](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm).
The checked-in npm 11.6.4 silently ignored the Multer override when Nest was
reachable only through the API workspace. Root `package.json` therefore also
pins the same `@nestjs/platform-express` 11.2.1 already used by the API, giving
npm a direct root dependency on which to apply the narrow Multer override.
This matches the workaround described in the upstream
[workspace override issue](https://github.com/npm/cli/issues/9659).
Remove the extra root dependency and override together once the API's upstream
Nest package resolves a patched Multer version without them; verify a clean
install and the production audit when doing so.

Previously retained production images, SBOMs, and release evidence do not cover
this changed source and dependency tree. A new production candidate must rebuild
and rebind those artifacts before deployment.

## Remaining work for restricted staging

1. Refresh the expired `crypto-lending-nonprod` AWS login and identify the
   existing staging destination. The read-only identity check currently fails
   with an expired-session error.
2. Supply two independent Ethereum RPC provider configurations through existing
   secret references. Endpoint/secret-reference names are sufficient for setup;
   credentials must not be committed or included in reports. Both sources need
   finalized reads, historical checkpoint lookup, and EIP-1898 contract calls.
3. Finish the owned runtime composition: database connection and metadata-key
   access, balance-reader grants, a populated finalized checkpoint, approved
   source/deployment identities, and the existing durable chain-assessment and
   trusted portfolio-assembly path. RPC credentials alone do not finish this.
4. Connect the restricted application/worker entry point and the separate market
   rate path. Deploy the composed infrastructure and pinned workloads to the
   selected staging destination. The network foundation is only one part of
   that infrastructure.
5. Exercise registered staging wallets against both real sources, verify
   cancellation, freshness, source disagreement and recovery, and retain the
   resulting deployed evidence. Only then update the provider's actual live-read
   status. Public rollout and financial transactions have additional gates in
   the [go-live plan](production-go-live-plan.md).

No RPC credentials were available in the inspected environment, and no live
wallet/provider read, cloud deployment, paid-resource creation, or transaction
was performed for this change. The remaining providers can follow the validated
connection pattern after Aave's restricted staging path is established.
