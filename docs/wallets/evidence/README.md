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

Every result must use evidence schema v2 and record the case/run ID, overall
result, tester, full candidate commit, package-lock SHA-256, environment,
OS/browser/wallet versions, network, UTC interval, terms state, audit snapshot,
ordered sanitized events, evidence links, and focused Jira follow-ups.

Never commit or attach a seed phrase, private key, credential, raw signature,
full wallet address, provider object, WalletConnect URI/topic, request/response
payload, or unsanitized packet capture.
