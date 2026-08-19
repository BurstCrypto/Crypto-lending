# Wallet lab rollback and kill-switch runbook

This runbook is for the restricted validation candidate only. There is no
authorized public deployment to roll back.

## Triggers

Stop testing immediately after a mainnet/transaction prompt, unexpected origin
or destination, wallet secret exposure, unapproved method/event, suspicious
dependency behavior, terms change, project-ID abuse, Critical/High finding, or
failure of the loopback/testnet boundary.

## Procedure

1. Stop the local wallet-lab process.
2. Set VITE_WALLET_LAB_ENABLED=false before any restart.
3. Remove or rotate WALLET_LAB_ACCESS_PASSWORD when access may have been
   exposed. Remove the local certificate/key paths before restarting when the
   HTTPS boundary or private key is suspect; follow the approved certificate
   process.
4. Set VITE_WALLETCONNECT_TERMS_ACCEPTED=false and remove the local project-ID
   value. Revoke or rotate the project ID in the vendor console when compromise
   or misuse is suspected.
5. Disconnect/delete the test sessions in every wallet used during the run.
6. Revoke the dapp's extension permissions and clear site/vendor storage from
   the dedicated browser profile. Never delete or reset a production wallet.
7. Preserve only sanitized defect evidence; quarantine any accidental secret
   capture and follow the incident process.
8. Record the trigger, operator, UTC time, affected candidate, and follow-up Jira
   ticket without copying sensitive values.

## Verification

- Opening https://127.0.0.1:4173 fails after the process stops.
- Startup fails before listening when any mandatory certificate/key/access value
  is absent or invalid; unauthorized HTTP/WSS access is rejected.
- A restart with the lab flag false renders the closed gate and loads no wallet
  runtime.
- WalletConnect is absent when its terms flag or project ID is absent/invalid.
- The root application build does not install or bundle tools/wallet-lab.
- No wallet remains connected and no protected signing action is available.
- The sanitized network observer sees no continuing lab relay/RPC requests.

## Drill record

| Field                               | Value                 |
| ----------------------------------- | --------------------- |
| Candidate commit and lock hash      | Pending               |
| Trigger exercised                   | Pending               |
| Operator                            | Pending               |
| UTC start/end                       | Pending               |
| Process stop verified               | Pass / Fail / Not run |
| Explicit-enable gate verified       | Pass / Fail / Not run |
| HTTPS/access fail-close verified    | Pass / Fail / Not run |
| WalletConnect gate verified         | Pass / Fail / Not run |
| Session/permission cleanup verified | Pass / Fail / Not run |
| Storage inspected before/after      | Pending               |
| Network quiet verified              | Pass / Fail / Not run |
| Sanitized evidence link             | Pending               |
| Findings/follow-up Jira             | Pending               |
| Independent reviewer                | Pending               |

Do not mark rollback tested until this table is completed against the frozen
candidate and independently reviewed.
