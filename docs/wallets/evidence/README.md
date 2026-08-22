# KAN-55 execution evidence

Status: **NO REAL-WALLET RESULT IS RECORDED YET**

Audit date: **2026-08-22**

This directory separates execution plans from results. A plan, unit test, mock
provider test, installed extension, or detected device is not a Pass. Add a
dated result only after an authorized human executes the case against one
frozen candidate and inspects the sanitized export.

- [desktop-execution-plan.md](desktop-execution-plan.md) prepares KAN-225.
- [mobile-execution-plan.md](mobile-execution-plan.md) prepares KAN-226 and
  defines the previously ambiguous M1/M2/M3 groups.
- [KAN-227](../KAN-227.md) is the consolidated desktop/mobile status packet. It
  may report `NOT_RUN`, blocked, or deferred coverage, but it cannot turn a
  plan, detected installation, unit test, mock, or missing artifact into a Pass.
- The canonical case procedures remain in the
  [manual validation runbook](../manual-validation-runbook.md).

KAN-225 owns desktop execution, KAN-226 owns mobile execution, and KAN-224 owns
the executable candidate freeze. The current packet supersedes historical
commit `01f7c63a2662734aaf581fd1c2641b85f459fd8b` with executable commit
`a0fc8527172cd29743c5d6475cf6264bbd6bde05`, wallet-lab Git tree
`58ba5e657d4584e60ce2db41aecf6d7a265d4351`, and package-lock SHA-256
`D723EC5710968AE94663CD2AE3CB107F11349281E3DC6DA580246B2BD71473B9`. That
prepared identity is not execution evidence: KAN-225 and KAN-226 must verify it
against a clean run checkout, and any later executable or lock change requires
KAN-224 to freeze a replacement.

Every result must use run schema v3 and record the case/run ID, overall result,
tester, full candidate commit, package-lock SHA-256, environment, OS/browser
versions, UTC interval, terms state, audit snapshot, and a bounded roster of
deterministic sanitized connection IDs with connector, exact wallet name and
version, and every exercised connector-compatible network. Ordered schema-v2
events must reference the matching roster connection and one of its recorded
networks; the exporter rejects missing, duplicate, mismatched, or ambiguous
legacy attribution. Include evidence links and focused Jira follow-ups where
applicable.

Same-tab recovery uses a strict session envelope bound to the exact candidate
commit and reviewed lock SHA-256. A candidate/lock mismatch or an unbound legacy
session is discarded instead of being attached to a new run.

Never commit or attach a seed phrase, private key, credential, raw signature,
full wallet address, provider object, WalletConnect URI/topic, request/response
payload, or unsanitized packet capture.
