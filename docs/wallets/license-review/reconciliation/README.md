# KAN-222 targeted license reconciliation

This directory records a mechanical, point-in-time reconciliation of the exact
`tools/wallet-lab` installation. It is evidence for independent review, not legal
advice, a license conclusion, or approval for distribution or public use.

## Scope and result

[`see-license-in-license-md.json`](see-license-in-license-md.json) selects every
SPDX package whose `licenseDeclared` or `licenseConcluded` is exactly
`SEE LICENSE IN LICENSE.md`. The 20 selected SPDX package records resolve through
the package lock to 30 installed package directories. The higher installation
count is expected: five WalletConnect 2.23.7 package/version records are each
installed under three nested dependency paths.

For each installed occurrence, the inventory verifies the installed
`package.json` name and version, records its lock path and integrity, locates the
package-root `LICENSE.md`, hashes its bytes with SHA-256, and records the license
heading and release date as a local text identifier. The identifier is descriptive;
it is not an SPDX license identifier or a legal classification. Package-root
notice files are also inventoried. None of the 30 selected installations has a
separate package-root notice file.

The sole SPDX `NOASSERTION` record is reported separately in the JSON. It is the
private first-party root `@crypto-lending/wallet-lab@0.1.0`; its existing
`THIRD_PARTY_NOTICES.md` is recorded, but no license conclusion is inferred.

The inventory is bound to these inputs:

- `tools/wallet-lab/package-lock.json` SHA-256
  `d723ec5710968ae94663cd2ae3cb107f11349281e3dc6da580246b2bd71473b9`
- `docs/wallets/license-review/wallet-lab-lock.spdx.json` SHA-256
  `01ce8055a2f2e60498b371a449a17063993a45273a7722a47c727862c932e17b`

## Still requires independent review

Qualified software/OSS counsel must independently determine the meaning and
effect of the two custom agreements, permitted use and distribution, contractual
acceptance, commercial/service terms, required attribution and license delivery,
and whether notices are sufficient for the actual shipped artifacts. Counsel or
another independent reviewer must also reconcile the rest of the SBOM and the
actual client/server bundles. This targeted inventory does not clear the private
root's `NOASSERTION`, replace the public-launch gate, or approve any release.

Any package, lockfile, installed-tree, license-text, build-output, product-flow,
or vendor-terms change invalidates this point-in-time evidence and requires a new
reconciliation and review.
