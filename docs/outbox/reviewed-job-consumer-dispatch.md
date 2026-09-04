# Reviewed business-job dispatch boundary

`ReviewedJobDispatcher` is the closed dispatch seam for a future production
business-job consumer. It accepts exactly the three version-1 contracts already
admitted to the transactional outbox:

- `ledger.journal-committed`;
- `yield.operation.submit`; and
- `blockchain.balance-sync` for Ethereum or Solana mainnet only.

The constructor requires all three handlers in one exact data-only registry.
At dispatch time the envelope, payload, version, identifiers, correlation
bindings, network, and retry shape are parsed again before a handler is chosen.
Unknown fields, legacy envelopes, accessors, custom prototypes, unknown
contracts, and non-launch networks fail with a fixed error. Handler exceptions
are also sanitized. Passing `dispatcher.dispatch` to `SqsJobWorker.processOne`
therefore leaves an invalid, unsupported, or failed job available for retry and
eventual dead-letter handling instead of acknowledging it.

This file does not provide a process entrypoint or any business handler. In
particular, it does not interpret a ledger event, read a chain, submit to a
lending provider, sign, or broadcast a transaction. A production consumer must
not be started until every queue contract has an idempotent, state-bound handler
with an explicit intended side effect. `yield.operation.submit` additionally
requires the separate provider and mainnet-write authorization gates.
