# Production network foundation

Status: first production deployment engineering slice, based on `origin/main`
at `3069301`. The template is implemented for local review and validation; no
cloud deployment has been performed and public launch remains blocked.

## Implemented resources

`infra/aws/production-network-foundation.json` defines 21 CloudFormation resources:

- One IPv4 VPC with a configurable private `10.x.0.0/16` range.
- Two workload subnets and two data subnets, spread across two explicit,
  distinct Availability Zones. The four `/24` ranges do not overlap.
- Four dedicated route tables and four explicit subnet associations.
- Eight separate security groups for API, web, outbox worker, balance consumer,
  migration tasks, PostgreSQL, Redis, and future private AWS service endpoints.

All resources and their ID outputs share the `ProvisionNetwork` condition.
`ActivationMode` defaults to `DISABLED`, which creates no resources defined by
this template. `PROVISION_INERT` requires the explicit resource-provisioning
acknowledgement and distinct Availability Zones. These CloudFormation rules
validate parameters; they do not supply organizational deployment authorization.

Changing an existing foundation stack back to `DISABLED` requests removal of its
conditional resources. It is not an application pause switch. The eventual
deployment controller must coordinate removal with dependent stacks and handle
runtime pause through workload counts and access controls.

The template defines no internet or NAT gateway, external route, IPv6 allocation,
public IP assignment, workload, database, IAM role, or endpoint. It exports
conditional resource IDs for future composition without CloudFormation exports
that would couple independently managed stacks.

Security groups have no inbound rules and contain only the explicit loopback
egress rule used to suppress EC2's automatically added unrestricted outbound
rule. Empty egress lists would not provide that protection on creation.
[AWS security-group reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-securitygroup.html)

VPC DNS support is enabled for future private service discovery. This slice does
not implement DNS query filtering, flow-log capture, private endpoints, or an
approved external-access path. Future workloads must use the dedicated groups;
the AWS-created default security group and network ACL are not hardened here.
These remaining controls must be addressed before workload activation.

## Local verification and release binding

```powershell
npm run infra:validate:production-network
npm run infra:test:production-network
python infra/aws/lint-cloudformation.py infra/aws/production-network-foundation.json
```

Verified on 2026-09-08:

| Check                                                   | Result                                 |
| ------------------------------------------------------- | -------------------------------------- |
| Network policy and regression suite                     | 49 passed on Windows and Linux         |
| Release-manifest and CI boundary suites                 | 37 passed on Windows and Linux         |
| Application deployment-guard suite                      | 87 passed on Windows and Linux         |
| Production preflight suite                              | 136 passed; one Windows link-test skip |
| CloudFormation lint                                     | Passed for the new template            |
| Infrastructure validation and secret scan               | Passed                                 |
| Artifact/release/preflight lint and preflight typecheck | Passed                                 |
| Repository formatting and whitespace                    | Passed                                 |

Local command logs are retained in
`.local-validation/production-readonly-deployment/`. Linux checks used an isolated
container with networking disabled. The existing production readiness gates
remain blocked pending application composition, deployment, and approval evidence.

The Node validator uses the existing bounded file loader and strict JSON parser.
It rejects ambiguous JSON, unreviewed resource types or template transforms,
unconditional resources, public addressing, permissive security-group rules,
misbound subnet/zone/route relationships, and altered output bindings. Successful
inspection explicitly reports `deploymentAuthorized: false` and zero AWS calls.

The regression suite also evaluates the actual template conditions and rules
independently of the validator, including default-disabled provisioning,
acknowledgement failure, and same-zone failure. CI runs these tests and the
CloudFormation linter. The release manifest includes both the exact template and
its local policy validator; modified bytes invalidate the candidate manifest.

The existing `production-infrastructure-contract.yaml`, production trust
registries, deployment entry points, and launch preflight retain their current
boundaries. This network template is a separate building block and is not yet
composed into a production application or accepted by a production executor.

## Next implementation steps

1. Compose the production data and service layer: encrypted database, cache,
   separate queues, logs, narrowly scoped IAM roles, and digest-pinned ECS tasks.
   Reuse the existing credential and workload boundaries without treating the
   non-production baseline as an approved production stack.
2. Add reviewed private service connectivity, DNS controls, flow logging, and
   monitoring before enabling workloads. Bind any external identity/provider
   access to the approved endpoint and source policies.
3. Connect the deployment lifecycle, durable reservation protocol, exact
   infrastructure/release binding, and post-deployment enrollment to the
   production deployment executor and approved destination.
4. Validate the composed application in restricted staging, then complete the
   balance-consumer and live read-only provider integration and deployed evidence.

The broader requirements remain in the
[go-live plan](production-go-live-plan.md#hard-launch-gates).

## CI baseline repair

The first `main` CI run after synchronization failed in the Linux PowerShell
application-guard tests. The fake Node validator set `LASTEXITCODE` and returned,
but the shell launcher used `pwsh -File`, which did not forward that nested exit
status to the caller. A small test-only PowerShell entry script now forwards the
arguments and explicitly exits with the validator's status. Production guard
logic and its rejection assertions remain unchanged.

The Linux run also outlasted the five-minute freshness window of timestamps
created once for the whole test suite. Each independent test now receives a
current fixture timestamp. Deliberately stale timestamps are still tested for
fixed-slot, auth/wallet, and Redis transitions against the unchanged production
freshness limit.
