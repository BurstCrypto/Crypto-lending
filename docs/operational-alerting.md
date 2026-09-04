# Operational alert delivery

Status: **locally enforced; external delivery evidence required before go-live**

The content-addressed `application-observability.yaml` child can attach its eight reviewed CloudWatch alarms to one
existing Amazon SNS topic. It does not create, update, discover, or validate an
SNS topic or subscription, and the local validators make no AWS or network
calls.

The parent supplies only exact physical resource names/identities needed by
the metrics and log queries. It pins the child bytes by SHA-256 and a versioned,
SHA-named S3 URL, and binds the artifact bucket/key/version hash into nested
stack parameters, tags, the change-set description, and the Deploy
acknowledgement. The guard reads existing artifacts only; it never creates a
bucket or uploads an object. Both alarms and the dashboard remain conditional,
so disabling both creates no resources inside the observability child.

## Deployment contract

`AlarmTopicArn` accepts only `NONE` or a bounded standard SNS topic ARN.
`EnableOperationalAlarms=true` fails the in-template CloudFormation rule when
the value is `NONE`. The guarded Plan and Deploy workflow is
stricter: an enabled deployment must supply an ARN in the selected AWS
partition, account, and Region. Wildcards, cross-account topics, cross-Region
topics, and cross-partition topics are rejected before change-set creation or
execution.

Each reviewed alarm leaves `ActionsEnabled` unset so the CloudWatch default
remains `true`; the local validator rejects any override that could suppress
delivery. Each alarm sends both its `ALARM` and `OK` transition to exactly
`!Ref AlarmTopicArn`:

- unhealthy API target hosts;
- low database free storage;
- Redis evictions across either deterministic cache member;
- any Redis authentication, command, key, or channel authorization denial
  across either deterministic cache member;
- excessive job-queue age;
- a non-empty job dead-letter queue;
- excessive balance-sync queue age; and
- a non-empty balance-sync dead-letter queue.

The dashboard binds visible depth, oldest-message age, and dead-letter depth
for both physically isolated queue pairs. It does not collapse the balance
queue into the generic jobs queue, so an idle generic worker cannot mask a
stalled or poisoned balance-sync backlog.

The Redis alarms use the node-level `CacheClusterId` dimension that ElastiCache
actually publishes. For this cluster-mode-disabled replication group,
ElastiCache derives the member IDs from the replication-group ID with the
documented `-001` and `-002` suffixes. Metric math sums both identities, so a
failover cannot move a denial or eviction outside the reviewed alarm. A
single-node environment simply contributes no `-002` datapoint; missing sparse
failure data is non-breaching.

Any Redis access-denial alarm blocks promotion while responders distinguish an
expected stale credential during a controlled rotation from an unauthorized or
misconfigured client. Correlate the alarm time with the exact deployment and
credential phase, stop the offending workload, and use `ACL LOG` only through
the separately reviewed operator path. Preserve only sanitized counts, node
identity, timestamps, disposition, and acknowledgement in release evidence;
never copy ACL-log payloads or credentials into source control. If the source
is not conclusively expected, revoke the affected credential and follow the
incident process before restoring traffic.

No `InsufficientDataActions` are configured. Each alarm retains its reviewed
`TreatMissingData` behavior, while a separate insufficient-data notification
would not by itself identify a customer-impacting incident or recovery. The
ALARM and OK routes must not be removed to compensate for that exception.

When alarms are deliberately disabled, the topic parameter may remain
`NONE`. Disabling alarms is an explicit deployment choice and is not
acceptable launch evidence for an operating production workload.

## External prerequisites

Before enabling production traffic, an authorized operator must provide and
independently verify all of the following outside this repository:

1. The topic exists in the deployment account and Region and its resource
   policy permits CloudWatch alarm publication without broad principals.
2. At least the primary on-call route and an independently owned backup route
   have confirmed subscriptions. Pending confirmations do not count.
3. The escalation record names the primary responder, backup responder,
   incident commander, and service owner, with acknowledgement and escalation
   targets appropriate to each alarm.
4. The runbook maps every alarm to triage, customer-impact assessment,
   mitigation, rollback or recovery, and closure steps.
5. Delivery is tested end to end through an explicitly authorized drill that
   observes one ALARM notification and the subsequent OK notification at every
   required recipient. A direct SNS test alone is insufficient.
6. The Redis access-denial alarm is exercised with an approved disposable
   non-production credential, and responders demonstrate sanitized triage and
   recovery without exposing the attempted credential or raw ACL-log entry.

Record the stack, account, Region, exact topic ARN, subscription confirmation
status, drill time, alarm used, ALARM and OK message identifiers or equivalent
delivery evidence, acknowledgements, any failed route, and remediation owner.
Do not record message bodies, credentials, webhook secrets, phone numbers, or
private email addresses in source control.

Run the drill before initial traffic, after changing the topic or any required
subscription, after changing alarm actions, and at least quarterly while the
service is live. A failed or overdue drill, an unconfirmed required
subscription, or an unowned escalation path blocks production launch and must
be remediated outside this local change.

## Cost and authority boundary

This change provisions nothing and authorizes no AWS action. SNS topics,
subscriptions, CloudWatch alarms, test state changes, and notification delivery
can incur charges or contact people. Creating or modifying them and performing
the drill require separate operator authorization and the repository's guarded
deployment workflow.
