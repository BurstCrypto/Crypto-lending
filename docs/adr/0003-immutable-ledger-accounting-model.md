# ADR 0003: Immutable multi-asset ledger accounting model

- Status: Proposed; Finance, Legal, Risk, Security, and ledger-owner approval required
- Date: 2026-08-20
- Jira: KAN-40, KAN-240, KAN-241, KAN-242
- Decision owners: Ledger backend, finance controls, Legal, Risk, and Security

## Context

The product coordinates value movement from externally managed wallets through direct settlement,
same-chain swaps, and cross-chain bridges. A single customer intent can therefore create several
independently finalizing movements, use several chain-qualified assets, and incur fees in assets other
than the asset delivered to the destination.

The product requirements call this history an internal immutable ledger. They require exact-precision
amounts, append-only journals, reversals instead of mutation, transaction states, idempotent writes,
USD values, itemized fees, transaction hashes, provider identifiers, and continuous reconciliation.
The requirements also state that the platform does not operate a proprietary bridge and must not imply
platform custody merely because it orchestrates a route.

Those requirements do not, by themselves, decide whether an externally managed wallet balance is a
platform asset, whether a customer position is a platform liability, when fee revenue is earned, or how
a statutory general ledger should present provider and network costs. Encoding any of those conclusions
without Finance and Legal approval would turn an operational record into an unsupported accounting or
custody assertion.

This ADR therefore defines an operational, double-entry, multi-asset subledger. It records what the
platform instructed and what independently observable sources show happened. It is **not** the
statutory GAAP/IFRS general ledger, a tax-lot ledger, proof of legal or beneficial ownership, or a
conclusion that the platform controls or custodies an asset. A separately approved mapping may later
feed statutory books without changing the historical operational postings.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this ADR are to be
interpreted as described by RFC 2119 and RFC 8174 while this decision remains Proposed.

## Decision status and scope

This is a proposed design contract for KAN-40 and its review subtasks. It does not add a schema, runtime
module, HTTP endpoint, provider integration, cloud resource, or live financial control.

The ADR becomes Accepted only when all unresolved decisions in this document have named, recorded
approvals from the applicable Finance, Legal, Risk, Security, and ledger owners. Local implementation
or passing tests cannot substitute for those approvals.

The initial implementation MUST contain one operational memorandum book. A future custodial or
corporate book MUST be a separate book with separately approved account classes and recognition rules.
A journal MUST NOT mix books.

## Terminology and model boundaries

- A **book** is an isolated balancing boundary with one debit/credit convention and one approved
  accounting purpose.
- An **asset** is one exact unit of account. Its identity includes its chain and native, contract, mint,
  or provider-instrument identity; its display symbol is not its identity.
- An **account** is an immutable location or control bucket for exactly one asset in exactly one book.
- A **transaction** is the customer or operational intent and its lifecycle.
- A **leg** is one independently submitted and independently settled part of a transaction, such as a
  source transfer, swap input, swap output, bridge deposit, bridge release, refund, or fee payment.
- A **journal** is an atomically committed set of postings that records one recognized economic fact.
- A **posting** is one positive exact amount on either the debit or credit side of one account.
- A **valuation snapshot** is immutable USD reporting metadata for an exact asset quantity. It is not a
  balancing quantity.
- A **fee component** is an itemized estimated or actual platform, network, DEX, bridge, or provider
  cost.
- An **external reference** is a typed locator for a quote, provider object, chain event, transaction,
  refund, or other source evidence. It is not an internal primary key or authorization credential.
- A **reversal** invalidates an accounting posting by recording its exact opposite.
- A **compensation** records a later real-world movement that offsets an earlier movement which remains
  historically true.
- An **adjustment** records a later difference, such as an actual fee differing from an estimate, without
  pretending the original snapshot was mutable.

The transaction lifecycle and the journal are separate concepts. `CREATED`, `QUOTED`,
`USER_APPROVED`, `SUBMITTED`, and `PENDING` describe workflow. A posted journal describes a recognized
fact. A rebuildable current-state projection MAY exist for query speed, but append-only state events and
posted journals remain authoritative.

## Books and accounts

### Operational memorandum book

The initial book is `OPERATIONAL_MEMO`. Its accounts describe in-scope movement controls and route
exposures; they do not assert financial-statement classification. Unless a separately approved policy
creates an evidenced, balanced opening or reconciliation journal, the sum of an account's postings is
a signed net flow from the ledger's chosen start, not a current holding. In particular, an
external-wallet or provider holding remains authoritative at its chain, custodian, or approved indexer.
Within this book only:

- a debit increases the recorded position at an account;
- a credit decreases the recorded position at an account; and
- a clearing account MAY have a credit balance while an external party owes an output asset, but the
  exposure MUST be bounded, monitored, and reconciled.

A negative source-account sum therefore means that the recorded workflow produced a net outflow; it
does not prove an overdraft or authorize another transfer. This memorandum book MUST NOT present its
net-flow sums as spendable customer balances.

This asset-like memorandum convention MUST NOT be copied into a future statutory book. A statutory
book must use its approved asset, liability, equity, revenue, and expense semantics.

The initial account roles are:

- `POSITION`: a chain-, wallet-, custody-, or provider-qualified value location;
- `EXTERNAL_CLEARING`: value delivered to or owed by a DEX, bridge, provider, or settlement venue;
- `FEE_SINK`: an external network, DEX, bridge, or provider fee recipient;
- `PLATFORM_FEE_COLLECTION`: an observed asset position in which an actually collected platform fee
  resides;
- `SUSPENSE`: a tightly controlled unresolved position used only when a recognized fact cannot yet be
  assigned to its final account; and
- `RESERVATION`: an optional, separate reservation-book role for holds. A reservation MUST NOT be
  presented as settled value.

### Account invariants

Every account MUST have an opaque, server-generated identifier and an immutable identity consisting of:

- book;
- exact asset identifier and asset-definition revision;
- owner or counterparty kind and internal identifier;
- location kind and internal identifier, including chain and wallet, provider, custody, or clearing
  location as applicable; and
- account role.

An account MUST contain exactly one asset. It MUST NOT be reused for another customer, provider,
wallet, chain, contract, mint, asset revision, or purpose. Closing an account may prevent new postings,
but MUST NOT change its identity or historical postings.

Raw wallet addresses and provider identifiers SHOULD remain behind internal location identifiers and
permissioned reference records. An account identity MUST NOT be derived from untrusted request fields,
an asset symbol, or an external reference.

The posting boundary MUST reject a source and destination that resolve to the same account. No-op value
movement creates no journal.

## Asset identity and exact-unit rules

### Chain-qualified asset identity

An asset definition MUST include:

- a stable internal asset identifier;
- a CAIP-2-style chain identifier or an explicitly approved non-chain namespace;
- `NATIVE`, contract, mint, or provider-instrument identity;
- immutable base-unit decimals and metadata revision;
- activation and retirement state; and
- the authoritative source of the identity metadata.

For the initial model, base-unit decimals MUST be an integer from `0` through `36`. Assets whose
authoritative decimals exceed that implementation ceiling require a new reviewed asset-policy version;
untrusted token metadata MUST NOT raise the limit dynamically.

Symbols and names are display metadata. `USDC` on Ethereum, `USDC` on Base, wrapped USDC, native USDC,
and a provider claim denominated in USDC MUST remain separate asset identifiers unless a later,
controlled conversion posts exact entries between them. A fungibility group MAY support display or
route discovery, but MUST NOT become a journal balancing dimension.

Changing decimals or settlement identity creates a new asset-definition revision. Historical postings
remain bound to the revision used when they were recorded.

### Atomic amounts

Every posting amount MUST be a positive integer count of the asset's smallest recorded unit. The
canonical wire and job representation is an ASCII decimal digit string with no sign, decimal point,
exponent, whitespace, or unnecessary leading zero. A posted amount therefore matches
`[1-9][0-9]*`.

The maximum universal posting amount is:

```text
2^256 - 1 =
115792089237316195423570985008687907853269984665640564039457584007913129639935
```

An approved asset MAY impose a smaller maximum. Aggregations MUST use an exact representation capable
of detecting overflow before persistence or serialization.

Application code MUST use an arbitrary-precision integer representation such as TypeScript `bigint`.
It MUST NOT convert a financial quantity through JavaScript `number`, IEEE-754 binary floating point,
or exponent notation.

Human-readable input MUST be converted using the immutable decimals on the exact asset revision. Input
with more fractional digits than that asset supports MUST be rejected; it MUST NOT be silently rounded.
Zero MAY appear in an estimate or fee snapshot to prove that a fee does not apply, but a zero-value
posting or empty journal is forbidden.

KAN-41 SHOULD use a PostgreSQL exact numeric domain or unconstrained `numeric` with explicit checks that
the value is positive, integral, and within the approved bound. `numeric(78,0)` alone is insufficient as
an input guard because PostgreSQL can round a fractional value to the declared scale before a table
check observes it. The only runtime posting function SHOULD accept canonical digit strings, validate
them before conversion, and deny direct table writes.

## Transactions, legs, journals, and postings

### Transaction and leg boundaries

A transaction MUST identify the authenticated platform account, intent, quote or preview when
applicable, route/configuration revisions, and ordered child legs. Every leg MUST record its asset,
source, destination, exact expected amount, dependencies, and external submission and settlement
references as they become known.

Each leg finalizes independently. A parent transaction MUST NOT be represented as atomically settled
when its external legs are not atomic. A downstream leg MUST NOT start before its required upstream
facts and authorizations are satisfied.

Quote creation, user approval, submission, and an unknown provider timeout do not, by themselves,
create a settled journal. They create immutable lifecycle or expected-leg records. A separately
balanced reservation book MAY record a hold, but reservation and settled books MUST remain distinct.

An operational journal is recognized when the approved source-of-truth policy establishes the
movement or fee as a fact. For a chain movement this requires the configured finality evidence. For a
provider movement this requires an authenticated provider event or a verified provider read. The
recognition policy and evidence revision MUST be retained with the journal.

### Journal invariants

Every committed journal MUST:

1. have an opaque, server-generated identifier;
2. belong to exactly one book, transaction, leg, and economic-event type;
3. contain at least two postings across at least two distinct accounts;
4. use only `DEBIT` or `CREDIT` sides and positive exact atomic amounts;
5. reference accounts in the journal's book whose immutable asset identity matches the posting asset;
6. balance independently for every exact asset identifier:

   ```text
   sum(DEBIT amount_atomic) = sum(CREDIT amount_atomic)
   ```

7. commit all postings and integrity metadata atomically, or commit none of them;
8. record database-controlled `recorded_at`, source `effective_at` or `settled_at`, evidence-observation
   time, actor or source identity, reason, and correlation identifiers; and
9. be immutable after commit.

A multi-asset journal is valid only if each asset group independently balances. Separate journals per
independently finalizing leg are preferred because they expose partial settlement and simplify
reconciliation. USD values MUST NOT make an otherwise unbalanced asset group valid.

The database must enforce balance at commit, not only in application validation. Runtime roles MUST NOT
insert, update, or delete journal data directly. A privileged posting boundary must create the complete
journal atomically after validating every cross-row invariant.

These atomicity requirements are staged by delivery ticket. KAN-41 owns the immutable core journal and
posting transaction. If KAN-41 implements a synchronous balance projection, that projection MUST share
the journal transaction, but the projection is optional. KAN-42 later composes any associated lifecycle
state event into the same transaction. KAN-43 later composes the durable idempotency result and existing
transactional outbox record into it. KAN-41 does not have to implement KAN-42 or KAN-43 to satisfy the
core schema contract.

An original journal remains `POSTED`. Whether it has later been reversed, adjusted, or compensated is
derived from immutable links to later journals; its status and postings do not change.

### Balance projections

Ledger account sums are exact signed net flows derived from posted journal lines. A transactionally
maintained balance table or read model MAY serve low-latency ledger queries, but it is not authoritative
for an external wallet or provider holding and MUST be rebuildable from the journal. Rebuilding from the
same committed journal set MUST always produce the same net-flow result.

Authorization to spend MUST use authoritative chain, custody, or provider data plus applicable
reservations and risk policy. A memorandum-account sum or eventually consistent display projection
MUST NOT authorize value movement.

## USD valuation snapshots

USD valuation is reporting and reconciliation metadata. It is not an asset conversion, balancing
quantity, promise of redemption, or assertion that a stablecoin equals one dollar.

An available valuation snapshot MUST include:

- purpose: `QUOTE`, `SETTLEMENT`, `REVERSAL`, `ADJUSTMENT`, or `BACKFILL`;
- exact asset identifier and asset-definition revision;
- exact valued quantity in atomic units;
- non-negative integer USD-rate mantissa and scale, representing USD per whole display unit;
- computed non-negative USD-value mantissa at the fixed internal scale of 18 decimal places;
- rounding mode `ROUND_HALF_EVEN`;
- source, source-policy version, and immutable quote, observation, or evidence reference;
- source `priced_at`, platform `observed_at`, and, for a backfill, `backfilled_at` timestamps; and
- freshness, confidence, depeg, and availability classifications required by the approved BAL-001
  policy.

The initial representation has these fail-closed numeric limits:

- rate mantissa `R` is a canonical ASCII string matching `0|[1-9][0-9]{0,77}`;
- rate scale `S` is a canonical integer from `0` through `36`;
- asset decimals `D` is the approved integer from `0` through `36` recorded on the asset revision; and
- the computed USD-value mantissa is a canonical non-negative integer of at most 96 decimal digits.

The posting amount limit makes `A` at most 78 digits, so `A * R` has at most 156 digits and every power
of ten used by this policy has exponent at most 72. The application and privileged database boundary
MUST validate digit counts and ranges before any numeric cast, exponentiation, or multiplication. A
value whose exact intermediate or rounded result exceeds a limit MUST be rejected; it MUST NOT be
truncated, saturated, converted through floating point, or persisted in exponent notation. These are
implementation ceilings, not approval of any price source or rate.

For amount `A`, asset decimals `D`, rate mantissa `R`, rate scale `S`, and fixed USD value scale `V = 18`,
the stored value MUST equal:

```text
ROUND_HALF_EVEN(A * R * 10^V / (10^D * 10^S))
```

The inputs and result MUST all be retained so the calculation is reproducible without calling the
price source again. For example, ten six-decimal USDC at a snapshot rate of `0.9998` USD has:

```text
A = 10,000,000
D = 6
R = 9,998
S = 4
V = 18
USD value mantissa = 9,998,000,000,000,000,000
USD display value = 9.998000000000000000
```

The exact asset quantity remains `10,000,000` regardless of the valuation.

Quote and settlement valuations are different snapshots even when their numbers match. A changed
price, fee rule, or oracle policy MUST NOT alter an earlier snapshot. A statutory reporting process may
later round to cents under its own approved policy; it MUST NOT rewrite the operational valuation.

BAL-001 owns price-source selection, fallback order, freshness, confidence, depeg thresholds, and the
behavior of a new execution when price is unavailable. This ADR does not approve a vendor or oracle.
Once an external movement has occurred, valuation unavailability MUST NOT prevent the exact asset fact
from being journaled. The ledger records an immutable `UNAVAILABLE` valuation observation and may later
append a `BACKFILL` snapshot that clearly states when it was produced. It MUST NOT pretend the price was
available at settlement.

An exact accounting reversal references the original valuation so that reporting can negate the same
recognized amount. A real compensation receives its own valuation at its own settlement time.

## Fee treatment

Every fee component MUST identify:

- category: `PLATFORM`, `NETWORK`, `DEX`, `BRIDGE`, or `PROVIDER`;
- stage: `ESTIMATED`, `ACTUAL`, or `ADJUSTMENT`;
- exact fee asset, amount, payer, and recipient or clearing role;
- whether the fee is added on top, deducted from input, or deducted from output;
- quote, fee-rule, route, provider, and transaction revisions as applicable; and
- source evidence and valuation snapshot.

Estimated fees do not create settled journals. An actual fee creates gross, itemized postings in the
asset actually paid. A fee in ETH is not converted into a USDC posting merely because the UI displays
its USD value. If a provider deducts a fee from input or output, the gross input or output and the fee
MUST remain reconstructable; the ledger MUST NOT record only a net amount that hides the fee.

A direct-compatible route MUST have a zero platform routing-fee snapshot and no platform-fee posting.
A zero snapshot proves the rule that applied; zero journal lines remain forbidden.

An actual amount that differs from its estimate creates a new `ACTUAL` component and, when value moved,
new postings. A later correction creates an `ADJUSTMENT` or an exact reversal; it does not modify the
estimate or actual component.

`PLATFORM_FEE_COLLECTION` records only an observed asset movement. It MUST NOT, by itself, be labeled
statutory revenue. Finance and Legal must approve when a platform fee is earned, whether it is refundable,
how taxes apply, and whether network, DEX, bridge, and provider fees are presented gross or net under
the applicable principal-versus-agent policy.

## External references and idempotency

### Typed external references

Every external reference MUST have a namespace, environment, object kind, role, canonical locator,
source, and observation time. Provider identifiers MUST be qualified by provider and environment; the
same sandbox and production string are not the same reference.

An on-chain transaction hash or signature alone is not a unique value movement. A chain-event locator
MUST include:

- exact chain identifier;
- transaction hash or signature in that chain's canonical representation;
- event, log, instruction, inner-instruction, or equivalent locator when one transaction contains
  several movements; and
- reference role, such as submission, settlement, fee, refund, or compensation.

The same chain transaction MAY support several journals when distinct event locators identify distinct
movements. The same canonical external event MUST NOT produce the same posting command twice.

Provider identifiers are opaque unless that provider's approved contract specifies normalization.
They MUST NOT be blindly lowercased, truncated, interpreted as secrets, or used as authorization. Raw
credentials, signatures that grant authority, private keys, access tokens, and unrestricted provider
payloads MUST NOT enter the ledger.

External references are append-only. Corrections add a superseding, reversal, or compensation relation;
they do not rewrite the original source evidence.

### Idempotent command rules

Every value-bearing command MUST use a durable idempotency identity scoped to:

- authenticated tenant or platform account;
- operation and API or job contract version; and
- a digest of the bounded idempotency key.

The record MUST contain a versioned canonical fingerprint of every value-relevant input, including
asset identifiers, atomic amounts, source and destination, quote and policy revisions, and authorized
actor. Canonicalization SHOULD follow RFC 8785 or an equally explicit, versioned contract. The raw key
SHOULD NOT be logged or retained when a digest is sufficient.

When KAN-43 composes idempotency and publication with the KAN-41 journal boundary, the idempotency
record, transaction identity, journal when applicable, any synchronous balance projection, and outbox
event MUST share the appropriate database transaction. The behavior is:

- same scope, key, and fingerprint: return the original transaction/result and create no new journal,
  state event, submission, or outbox event;
- same scope and key with a different fingerprint: reject with an idempotency conflict; and
- concurrent identical commands: exactly one wins the uniqueness boundary and every caller observes
  the same result.

Financial idempotency identities MUST remain reserved for the financial-record retention period. They
MUST NOT silently expire and later authorize a second movement.

Each provider or chain submission and each inbound provider event MUST also have a durable,
leg-qualified idempotency identity. A timeout with an unknown external outcome remains `PENDING` and is
polled or reconciled. It MUST NOT be resubmitted blindly.

## Failure, reversal, adjustment, and compensation semantics

### Failure

`FAILED` describes an intent or leg outcome; it does not prove that no money moved.

- Failed preflight, user rejection, quote expiry, or provider rejection before movement creates no
  journal.
- A reverted chain transaction that consumed gas creates an actual network-fee journal and no principal
  movement journal.
- An unknown submission outcome remains `PENDING`, not `FAILED`.
- A confirmed source movement with missing output remains journaled. While the external outcome is
  unknown, the parent remains `PENDING` and a durable reconciliation or manual-review case is opened.
  Once terminal failure is confirmed, the intent may become `FAILED` only while separately exposing
  its financial impact and recovery status. The source fact is not removed.
- Downstream legs stop after an unmet dependency. No synthetic posting may make a partial external route
  appear atomic or settled.

KAN-42 MUST define parent and per-leg state transitions plus a separate recovery or manual-review
dimension so `FAILED` cannot be misread as “no financial impact.”

### Exact accounting reversal

A full accounting reversal MUST be a new journal which:

- identifies exactly one original journal through a unique `reverses_journal_id` relation;
- uses the same book, accounts, assets, amounts, and line multiplicity;
- swaps every original debit to credit and every original credit to debit;
- references the original valuation for reversal reporting;
- records an authorized actor or trusted source, reason, approval reference, and database timestamp; and
- commits its reversal journal atomically. Once KAN-42 and KAN-43 are integrated, the associated state
  event and outbox record MUST share that transaction.

The original remains unchanged. The MVP MUST reject self-reversal, partial reversal, a second reversal
of the same original, and reversal of a reversal. A partial correction is a separately explained
adjustment, not a mislabeled full reversal.

An on-chain movement that really occurred MUST NOT receive an accounting reversal merely because the
user wants the economic result undone. It is reversed as an accounting fact only when trusted evidence
shows that the recognized fact became invalid, for example an approved reorganization policy proving
the event is no longer canonical.

### Compensation and refund

A refund, provider-supported recovery, or reversing on-chain transfer is a new economic fact. It MUST:

- create a new transaction leg and journal;
- have its own exact amount, asset, settlement evidence, hash or provider reference, finality, fees,
  and valuation;
- link to the earlier transaction or journal through `compensates`, not `reverses`; and
- preserve any uncompensated amount and fee difference explicitly.

A parent transaction becomes `REVERSED` only after the approved state policy proves that every intended
economic effect has been fully reversed or compensated. Partial compensation remains visibly partial
and under recovery. The platform MUST NOT say an on-chain transfer was reversed before the compensating
transaction settles.

## Exact balanced examples

These examples use memorandum accounts, so debit increases a location's position and credit decreases
it. Asset labels below stand for exact internal asset identifiers and revisions:

```text
USDC_BASE       = USDC contract identity on eip155:8453, 6 decimals
USDC_ETHEREUM   = USDC contract identity on eip155:1,    6 decimals
USDT_ETHEREUM   = USDT contract identity on eip155:1,    6 decimals
ETH_BASE        = native ETH identity on eip155:8453,   18 decimals
```

The symbols are explanatory only. Implementations balance by exact asset identifier.

The examples deliberately omit earlier activity and do not seed opening holdings. Their account sums
therefore show only the illustrated net flow. A credited source may have a negative sum in this isolated
fixture; that is not a negative wallet balance, because external holdings remain chain, custodian, or
provider truth.

### Direct settlement with zero routing fee

Ten USDC on Base moves directly from a user source position to the accepted settlement position:

```text
Journal DIRECT-1 — asset USDC_BASE

DEBIT   PROVIDER_SETTLEMENT_POSITION       10,000,000
CREDIT  USER_SOURCE_POSITION               10,000,000
                                                ----------
Debits                                         10,000,000
Credits                                        10,000,000
```

The fee snapshot records platform routing fee `0`. It creates no zero posting. A separately incurred
network fee would use a separate `ETH_BASE` journal.

### Same-chain swap with an input-asset DEX fee

One hundred USDT on Ethereum supplies a swap. The DEX takes `0.300000` USDT from input and produces
`99.500000` USDC. Input and output assets balance separately:

```text
Journal SWAP-IN-1 — asset USDT_ETHEREUM

DEBIT   DEX_INPUT_CLEARING                   99,700,000
DEBIT   DEX_FEE_SINK                            300,000
CREDIT  USER_SOURCE_POSITION                100,000,000
                                                -----------
Debits                                        100,000,000
Credits                                       100,000,000

Journal SWAP-OUT-1 — asset USDC_ETHEREUM

DEBIT   USER_DESTINATION_POSITION             99,500,000
CREDIT  DEX_OUTPUT_CLEARING                   99,500,000
                                                 ----------
Debits                                         99,500,000
Credits                                        99,500,000
```

The USDT and USDC totals are never added to prove balance. Their USD snapshots explain economic value
at quote and settlement but do not change either journal.

### Cross-chain bridge with a source-asset bridge fee

Fifty USDC leaves Ethereum, the bridge retains `0.050000` source USDC, and `49.950000` destination USDC
is released on Base:

```text
Journal BRIDGE-SOURCE-1 — asset USDC_ETHEREUM

DEBIT   BRIDGE_SOURCE_CLEARING                49,950,000
DEBIT   BRIDGE_FEE_SINK                           50,000
CREDIT  USER_SOURCE_POSITION                 50,000,000
                                                ----------
Debits                                         50,000,000
Credits                                        50,000,000

Journal BRIDGE-DESTINATION-1 — asset USDC_BASE

DEBIT   USER_DESTINATION_POSITION             49,950,000
CREDIT  BRIDGE_DESTINATION_CLEARING           49,950,000
                                                 ----------
Debits                                         49,950,000
Credits                                        49,950,000
```

`USDC_ETHEREUM` and `USDC_BASE` remain different assets even if the bridge provider describes the
route as moving “USDC.”

### Failure before movement

A quote expires, preflight fails, the user rejects authorization, or the provider rejects before any
submission. The transaction or leg becomes `FAILED` with an append-only state event and reason.

```text
Journals: 0
Postings: 0
```

The implementation MUST NOT create an empty or zero-value “failure journal.”

### Reverted transaction with an actual gas fee

A Base transaction reverts after consuming `0.000021` ETH. No USDC moved, but the actual gas fee did:

```text
Journal FAILED-GAS-1 — asset ETH_BASE

DEBIT   NETWORK_FEE_SINK              21,000,000,000,000
CREDIT  USER_GAS_POSITION             21,000,000,000,000
                                         ------------------
Debits                                  21,000,000,000,000
Credits                                 21,000,000,000,000
```

The intent is `FAILED` with financial impact. There is no principal-asset journal.

### Partial bridge settlement

Twenty USDC leaves the Ethereum source and the destination outcome is still unknown:

```text
Journal PARTIAL-SOURCE-1 — asset USDC_ETHEREUM

DEBIT   BRIDGE_SOURCE_CLEARING                20,000,000
CREDIT  USER_SOURCE_POSITION                 20,000,000
                                                ----------
Debits                                         20,000,000
Credits                                        20,000,000

Destination journal: none until destination movement is proven
```

The source leg is preserved as settled. The parent remains `PENDING` while the result is unknown, stops
dependent work, and opens one idempotent recovery case. It is not `SETTLED` or `REVERSED`.

### Full accounting reversal

If `DIRECT-1` was an invalid accounting recognition rather than a real movement that must be returned,
its full reversal is:

```text
Journal REVERSAL-OF-DIRECT-1 — asset USDC_BASE
reverses_journal_id = DIRECT-1

DEBIT   USER_SOURCE_POSITION               10,000,000
CREDIT  PROVIDER_SETTLEMENT_POSITION       10,000,000
                                             ----------
Debits                                      10,000,000
Credits                                     10,000,000
```

`DIRECT-1` remains immutable. The reversal uses the original valuation and cannot itself be reversed
under the MVP rule.

### Real compensation

If `DIRECT-1` was a real settled transfer and the provider later returns all ten USDC, the amounts have
the same direction as an opposite movement but different semantics:

```text
Journal COMPENSATION-FOR-DIRECT-1 — asset USDC_BASE
compensates_journal_id = DIRECT-1
external reference = new settled chain event or provider event

DEBIT   USER_SOURCE_POSITION               10,000,000
CREDIT  PROVIDER_SETTLEMENT_POSITION       10,000,000
                                             ----------
Debits                                      10,000,000
Credits                                     10,000,000
```

This journal has its own settlement valuation, timestamp, finality evidence, and fees. The original
movement remains true. A refund of less than `10,000,000` leaves the difference explicit and cannot mark
the parent fully `REVERSED`.

### Routed settlement with separately itemized fees

A materially orchestrated route produces gross output of `100.000000` USDC on Base. It deducts a
`0.200000` platform fee and `0.100000` provider fee, delivering `99.700000` USDC. It separately consumes
`0.000015` ETH as network gas:

```text
Journal ROUTED-OUTPUT-1 — asset USDC_BASE

DEBIT   USER_DESTINATION_POSITION             99,700,000
DEBIT   PLATFORM_FEE_COLLECTION                  200,000
DEBIT   PROVIDER_FEE_SINK                         100,000
CREDIT  ROUTE_OUTPUT_CLEARING                 100,000,000
                                                -----------
Debits                                        100,000,000
Credits                                       100,000,000

Journal ROUTED-GAS-1 — asset ETH_BASE

DEBIT   NETWORK_FEE_SINK              15,000,000,000,000
CREDIT  USER_GAS_POSITION             15,000,000,000,000
                                         ------------------
Debits                                  15,000,000,000,000
Credits                                 15,000,000,000,000
```

The quote, fee rule, actual fees, payer, and deduction modes remain separately queryable. The USD UI
may sum valuations for display, but it cannot replace either exact-asset balance.

## Security and integrity requirements

KAN-41 and later implementation MUST apply the repository's established least-privilege database
pattern:

- a non-login owner controls ledger objects;
- runtime roles receive no direct `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, trigger-management, sequence,
  or ownership capability on ledger tables;
- `PUBLIC` receives no schema, table, sequence, or function capability;
- writes occur only through narrowly scoped `SECURITY DEFINER` functions with an exact fixed
  `search_path`, fully qualified names, validated canonical input, and no dynamic SQL;
- runtime receives only necessary `SELECT` and exact function `EXECUTE`, without grant option;
- migration verification checks owners, ACLs, effective privileges, function definitions, search paths,
  constraints, trigger enabled state, and indexes; and
- Docker-backed adversarial tests prove that direct mutation, unbalanced commit, trigger bypass,
  unauthorized cross-account access, unsafe grant option, and duplicate posting fail.

The authenticated actor and tenant scope come from the trusted principal, never a request body,
external reference, wallet address, or idempotency key. Every privileged state transition, reversal,
adjustment, and compensation records actor, reason, timestamp, and approval or source evidence.

Ledger data MUST NOT contain private keys, seed phrases, bearer tokens, database credentials, provider
secrets, unrestricted webhook bodies, or unbounded user metadata. Audit queries must enforce tenant and
role isolation, bounded pagination, stable cursors, privacy-safe logs, and retention policy.

Append-only privileges protect against the application runtime; they do not make a database owner or
superuser incapable of tampering. Each journal SHOULD have a deterministic canonical integrity digest.
Backups, restricted administrative access, independently retained audit evidence, and any externally
anchored checkpoint require separate operational approval. A digest stored beside mutable data is
detection metadata, not proof against a privileged attacker.

## Scalability and performance requirements

The source journal remains normalized and append-only. Implementations MAY add transactionally updated
account-balance and current-state projections, read replicas, and time-based partitioning, provided each
projection is reproducible from the source journal and does not weaken atomic balance validation.

The design MUST avoid a global gapless sequence, global journal lock, or single global hash chain. Those
structures serialize otherwise independent accounts and create a high-availability bottleneck. Opaque
identifiers, per-journal balance checks and digests, and account/time cursor indexes preserve locality
without making one global row the write coordinator.

KAN-41 SHOULD plan indexes for transaction, leg, account plus recorded time, typed external reference,
reversal/compensation relation, and valuation source time. Uniqueness indexes must enforce idempotency
and external-event rules. Write functions SHOULD lock affected projections in deterministic account-ID
order to reduce deadlocks while retaining the existing bounded serialization/deadlock retry behavior.

Large historical queries MUST use bounded, stable cursor pagination rather than offsets or full-ledger
sums. Partitioning, archival, or projection changes MUST preserve reversal links, transaction tracing,
and exact rebuild tests.

## Reconciliation requirements

Every posted leg MUST be traceable to its expected route record and independently observed outcome.
Reconciliation compares exact chain-qualified asset, atomic amount, source, destination, fee category,
provider object, event locator, finality, and state. USD valuation differences are reported separately
from exact-unit movement differences.

Reconciliation MUST:

- be checkpointed, replayable, and idempotent;
- classify missing, duplicate, amount, asset, address/location, fee, state, and finality mismatches;
- keep provider or chain unavailability retryable rather than claiming a match or failure;
- reopen affected results under the approved reorganization policy;
- create one durable discrepancy and alert per stable discrepancy identity;
- preserve original journals during replay and resolution; and
- verify that a complete journal replay reproduces every authoritative balance projection.

Any tolerance MUST be explicit, asset- and source-specific, versioned, and approved. Exact on-chain
atomic amounts do not receive a convenience rounding tolerance.

## Downstream handoffs

### KAN-41 / LED-002: Append-only ledger schema

KAN-41 implements the approved immutable core: the exact amount domain, accounts, transactions, legs,
journals, postings, valuations, fee components, typed references, journal relations, privileged posting
functions, constraints, and migration verifier. A rebuildable balance projection is optional; if
implemented, it must be transactionally consistent with the journal. KAN-41 must update the deployment
grant recipe without granting direct ledger DML and extend blank-migrate, rollback, ACL, mutation,
cleanup, and Docker-backed integration tests. Lifecycle composition remains KAN-42 scope, and
idempotency plus outbox composition remains KAN-43 scope.

KAN-41 MUST NOT silently resolve an approval item from this ADR. A changed accounting decision first
updates and re-approves the ADR.

### KAN-42 / LED-003: Transaction lifecycle state machine

KAN-42 defines the explicit parent and per-leg transition table for `CREATED`, `QUOTED`,
`USER_APPROVED`, `SUBMITTED`, `PENDING`, `SETTLED`, `FAILED`, and `REVERSED`. It also defines recovery or
manual-review state, unknown external outcome, partial settlement, actor/reason history, finality,
reorganization, and the exact gates for terminal states.

KAN-42 must preserve the distinction between workflow state and posted facts. It must not mark a real
on-chain movement reversed without a settled reversing or compensating transaction.

### KAN-43 / LED-004: Idempotent writes and transactional outbox

KAN-43 implements authenticated idempotency scope, versioned request fingerprints, conflict behavior,
provider and inbound-event deduplication, concurrent-write tests, and an outbox record committed
atomically with ledger effects. It should reuse the existing PostgreSQL transaction and outbox
infrastructure rather than introduce a second delivery system.

No downstream ticket may perform an external submission inside a database transaction. The outbox and
provider idempotency contracts coordinate the saga; unknown outcomes are reconciled instead of blindly
retried.

## Rejected alternatives

### Mutable balances as the ledger

Rejected because a current number cannot explain its provenance, replay history, fees, partial
settlement, or corrections. A mutable balance is permitted only as a rebuildable projection.

### Single-entry movement records

Rejected because they cannot enforce conservation within each asset or expose unresolved clearing and
fee positions.

### Floating-point or display-decimal quantities

Rejected because binary floats and implicit decimal rounding can create or destroy atomic units. Exact
base-unit integers are the value truth.

### PostgreSQL `numeric(78,0)` as the only integer guard

Rejected because a fractional input can be rounded to scale zero before later checks observe it. Raw
canonical input validation and an explicit exact numeric domain are required defense in depth.

### Ticker-level or USD-level balancing

Rejected because same-symbol assets can have different chains, contracts, redemption rights, finality,
and risks. USD valuations are estimates and cannot repair an asset imbalance.

### Assuming every stablecoin is always worth one USD

Rejected because it hides depeg and unavailable-price risk and conflicts with BAL-001.

### Editing, deleting, voiding, or overwriting a journal

Rejected because it destroys the evidence required for audit and reconciliation. Reversal, adjustment,
and compensation are append-only facts.

### Calling every refund a reversal

Rejected because a real transfer and its later return are two real movements with different hashes,
fees, times, finality, and valuations.

### Failure journals containing zero postings

Rejected because workflow history belongs to state events and an empty journal weakens the invariant
that every journal records value.

### A global hash chain, lock, or gapless journal number

Rejected for the operational ledger because it serializes all writers and still does not prevent a
database superuser from rewriting both data and hashes. An externally mandated numbering or sealing
scheme requires a separate statutory or regulatory decision.

### Broad runtime table DML

Rejected because application validation is not a substitute for database-enforced balance,
immutability, tenant scope, and idempotency.

## Consequences

The model makes every recognized movement, fee, route exposure, correction, and recovery exactly
traceable without treating asynchronous external systems as one atomic database. It allows balance and
state projections to scale while keeping a deterministic source of truth.

The cost is additional account and clearing structure, exact asset registration, explicit finality and
valuation policy, more journal lines than a net movement log, and durable recovery for partial outcomes.
Those costs are intentional controls for a system that coordinates real value.

This ADR does not make routes, providers, custody, revenue policy, statutory reporting, or live
deployment approved.

## Unresolved approvals

The ADR remains Proposed until recorded decisions resolve all of the following:

1. **Finance and Legal:** confirm that `OPERATIONAL_MEMO` is not presented as the statutory ledger and
   approve any mapping to assets, liabilities, revenue, expense, customer-money, or safeguarding books.
2. **Legal and Compliance:** determine custody, control, beneficial-ownership, record-retention, privacy,
   customer-disclosure, and jurisdiction-specific obligations for every supported route and provider.
3. **Finance:** approve the 18-decimal internal USD value scale, half-even rounding, reporting-currency
   conversion, close/backdating policy, and treatment of later valuation backfills.
4. **Risk and BAL-001 owners:** approve valuation sources, source fallback, freshness, confidence, depeg,
   unavailable-price, and execution-blocking policy. No stablecoin receives a fixed one-dollar
   assumption from this ADR.
5. **Finance and Legal:** approve when platform fees are earned or refundable, tax treatment, and
   principal-versus-agent gross/net presentation of network, DEX, bridge, and provider costs.
6. **Risk, Operations, and chain owners:** approve finality thresholds, fork/reorganization behavior,
   bridge/provider unknown-outcome limits, suspense and clearing limits, and who bears slippage, fee
   variance, and loss.
7. **Product, Operations, and KAN-42 owners:** approve customer-facing meaning for partial settlement,
   `FAILED` with financial impact, recovery/manual review, compensation, and `REVERSED`.
8. **Security and Data Governance:** approve administrative access, integrity evidence, retention,
   archival, incident response, and permissioned audit-query controls.
9. **Ledger owner:** approve the universal amount bound, asset-registration lifecycle, full-reversal-only
   MVP scope, and all balanced examples in this ADR.

Approval must identify the decision, approver, UTC time, scope, and immutable evidence reference. A Jira
status change alone is not accounting approval.

## Authoritative references

- [Product MVP: Routing Fee Rules, Transaction Preview, Internal Ledger, and Reconciliation](../../unified_multi_wallet_tokenized_investment_mvp_epic.md#20-routing-fee-rules)
- [Phase 1–3 Jira source: EP-LED, LED-001 through LED-005, BAL-001, FEE-001 through FEE-003, and XWT-004 through XWT-006](../../jira_phase_1_3.json)
- [RFC 2119: Key words for use in RFCs to Indicate Requirement Levels](https://www.rfc-editor.org/rfc/rfc2119)
- [RFC 8174: Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words](https://www.rfc-editor.org/rfc/rfc8174)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
- [RFC 3339: Date and Time on the Internet](https://www.rfc-editor.org/rfc/rfc3339)
- [PostgreSQL: Numeric Types](https://www.postgresql.org/docs/current/datatype-numeric.html)
- [PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)
- [PostgreSQL: Privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
- [PostgreSQL: Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Chain Agnostic Improvement Proposal 2: Blockchain ID Specification](https://chainagnostic.org/CAIPs/caip-2)
- [ERC-20 Token Standard](https://eips.ethereum.org/EIPS/eip-20)
- [Solana transaction structure](https://solana.com/docs/core/transactions)
- [IEEE 754 floating-point arithmetic standard](https://standards.ieee.org/ieee/754/6210/)
- [ISO 4217 currency codes](https://www.iso.org/iso-4217-currency-codes.html)
- [IFRS Conceptual Framework](https://www.ifrs.org/issued-standards/list-of-standards/conceptual-framework/)
- [FASB Accounting Standards Codification](https://asc.fasb.org/)

The external references inform implementation and review. They do not replace jurisdiction-specific
legal advice, an approved statutory accounting policy, provider due diligence, or the approvals listed
above.
