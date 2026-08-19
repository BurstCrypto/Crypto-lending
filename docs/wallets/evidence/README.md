# KAN-55 execution evidence

Status: **NO REAL-WALLET RESULT IS RECORDED YET**

This directory separates execution plans from results. A plan, unit test, mock
provider test, installed extension, or detected device is not a Pass. Add a
dated result only after an authorized human executes the case against one
frozen candidate and inspects the sanitized export.

- [desktop-execution-plan.md](desktop-execution-plan.md) prepares KAN-225.
- [mobile-execution-plan.md](mobile-execution-plan.md) prepares KAN-226 and
  defines the previously ambiguous M1/M2/M3 groups.
- The canonical case procedures remain in the
  [manual validation runbook](../manual-validation-runbook.md).

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
