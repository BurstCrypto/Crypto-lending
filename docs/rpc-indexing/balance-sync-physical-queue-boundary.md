# Balance-sync physical queue boundary

Status: implemented as a dormant transport boundary; no balance consumer, indexer egress, or deployment has been activated.

The reviewed logical outbox destination remains `jobs` for database compatibility. At the SQS adapter boundary, only the exact reviewed `blockchain.balance-sync@1` envelope is sent to `SQS_BALANCE_QUEUE_URL`. Reviewed ledger and yield envelopes continue to use `SQS_QUEUE_URL`. An absent balance queue setting fails balance publication closed and never falls back to the jobs queue.

The four configured URLs (`SQS_QUEUE_URL`, `SQS_DEAD_LETTER_QUEUE_URL`, `SQS_BALANCE_QUEUE_URL`, and `SQS_BALANCE_DEAD_LETTER_QUEUE_URL`) must be pairwise distinct. Production parsing additionally requires canonical, regional HTTPS SQS URLs. Readiness checks all four queue identities and both exact source-to-DLQ redrive relationships.

Mixed outbox batches are grouped by physical source queue. Each physical request has its own abort scope, while results remain aligned to original input order. One queue request failing does not cancel or remap the other physical request.

`SqsJobWorker` now binds receive, visibility heartbeat, retry visibility, deletion, and queue metrics to one selected physical source. The registered worker remains the generic jobs worker only. It rejects balance jobs before invoking a handler. The dormant balance dispatcher and balance worker mode accept only exact `blockchain.balance-sync@1` envelopes and reject ledger, yield, unknown, or wrong-version jobs before handler invocation.

Infrastructure templates define separate KMS-encrypted source/DLQ pairs with TLS-only policies and exact redrive relationships. The outbox worker may publish to both source queues and inspect all four queues, but has no receive/delete permission. The API may only inspect all four queues. No balance consumer ECS service or desired count exists.

LocalStack creates both pairs and Docker health verifies all four queue names. CI and the local demo use four explicit, distinct loopback URLs.

## Remaining activation gates

- Keep the balance consumer desired count at zero/absent until its wallet resolver, mainnet RPC egress, checkpoint persistence, provider credentials, and operational ownership are separately approved.
- Perform an authorized deployed IAM simulation proving the outbox worker can send only to the two source queues and cannot receive/delete, and proving the API is read-only.
- Capture live queue attributes for both redrive pairs, KMS use, retention, TLS denial, alarms, DLQ redrive, and cross-queue receipt-handle failure behavior.
- Add independent-source/finality evidence for the dormant Ethereum and Solana indexers before any balance result can become a financial input.
