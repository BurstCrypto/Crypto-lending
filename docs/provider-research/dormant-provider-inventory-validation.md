# Dormant provider inventory validation

`npm run infra:validate:providers` performs an offline, fail-closed inventory check for the exact ten entries in the mainnet planning directory. It requires one exact adapter, hostile-path spec, and research note for each of Aave, Morpho, Compound, Spark, Euler, Gearbox, Kamino, Save, Project 0/marginfi, and Jupiter.

The validator reads repository files only. It has no endpoint, DNS, HTTP, provider SDK, credential, subprocess, chain, cloud, or write capability. It verifies that the planning directory remains `PLANNED`, `NOT_CONNECTED`, `UNAVAILABLE`, `NOT_ASSESSED`, action-free, and unable to authorize a financial action. Each reader must retain its explicit non-persistence, non-recommendation, and non-financial markers; Aave's older evidence contract has no persistence/recommendation capability and is checked for its explicit false financial-authority marker.

Runtime source files are scanned for every exact adapter class and import stem. A reference outside the adapter itself fails validation, as does a Nest registration decorator in an adapter. This intentionally prevents the static inventory from becoming runtime wiring through a module, barrel, CLI, controller, or other production source.

Passing this validator proves only local artifact completeness and dormancy. It does not approve a provider, market, asset, endpoint, source pair, risk decision, recommendation, transaction, or production activation. All ten remain unavailable and the production live-provider count remains zero.
