# SCRUM-173 Network Baseline Runbook

This runbook provisions and operates the `network-shared-dev` Terraform component: the
shared CrewSafe staging network in `ap-southeast-1`. It is written for account owners and
infrastructure operators.

Terraform runs only in GitHub Actions. Never run `terraform init` against a real backend,
plan, apply, destroy, import, state, or force-unlock on a workstation. Do not configure a
local AWS profile or download Terraform state or saved-plan artifacts.

Related:

- [SCRUM-173 plan](../plans/SCRUM-173-network-baseline-plan.md) — the design and its trade-offs
- [SCRUM-155 state-backend runbook](SCRUM-155-terraform-state-backend.md) — the remote state this depends on
- [SCRUM-154 shared Cognito runbook](SCRUM-154-shared-cognito.md) — the component pattern this follows

## 1. What this procedure creates

In the single designated shared account, `network-shared-dev` creates **19 resources**:

| Resource | Count |
| --- | ---: |
| VPC `10.0.0.0/16`, DNS support and hostnames enabled | 1 |
| Internet gateway | 1 |
| Public subnets (`10.0.0.0/24`, `10.0.1.0/24`), no auto-assigned public IP | 2 |
| Private subnets (`10.0.10.0/24`, `10.0.11.0/24`) | 2 |
| Elastic IP and NAT gateway, both in `ap-southeast-1a` | 2 |
| Route tables (public → IGW, private → NAT) | 2 |
| Route table associations | 4 |
| Security groups (application runtime, database) | 2 |
| Database ingress rule, 5432/TCP from the app group by reference | 1 |
| Application egress rule, unrestricted | 1 |
| Default security group, adopted and stripped of all rules | 1 |

It creates **no** database, no compute, no load balancer, and no load balancer security
group. Those belong to the components this one unblocks.

## 2. Prerequisites

1. The SCRUM-155 remote state backend exists in the target account.
2. You know which account alias is the **designated shared account**. There is exactly one
   network; dispatching against another account creates a second, divergent one.
3. The plan and apply roles carry the policies in section 3. **A plan dispatched before this
   fails with an EC2 authorization error and creates nothing** — a safe failure, but a
   confusing one if unexpected.

## 3. Attach the IAM policies

These are hand-applied documents, not Terraform-managed resources — the same manual step the
SCRUM-154 and SCRUM-155 runbooks describe.

1. Attach the contents of
   [`infra/terraform/network/iam/plan-role-policy.json`](../../infra/terraform/network/iam/plan-role-policy.json)
   to the account's Terraform **plan** role. It grants read-only `ec2:Describe*` actions for
   the resource types above and nothing else.
2. Attach the contents of
   [`infra/terraform/network/iam/apply-role-policy.json`](../../infra/terraform/network/iam/apply-role-policy.json)
   to the account's Terraform **apply** role. It adds create, modify, delete, and tag actions
   for those same types, plus `ec2:AllocateAddress` and `ec2:ReleaseAddress` for the NAT
   gateway's elastic IP.

Do not widen either policy to `ec2:*`. Each new resource type is a reviewed addition.

## 4. Plan

Dispatch the **Terraform State Plan** workflow:

| Input | Value |
| --- | --- |
| `target_account_alias` | the designated shared account's alias |
| `terraform_component` | `network-shared-dev` |

Expected: a clean plan, **19 to add, 0 to change, 0 to destroy**, against
`crewsafe/network/shared-dev.tfstate`.

Record the run id — the apply requires it.

## 5. Review the plan — three mandatory checks

The mocked tests in `infra/terraform/network/tests/network.tftest.hcl` cover the rules we
declare. Two properties are invisible to them and are checked **here or nowhere**.

1. **The database security group must show no egress rule.** AWS attaches an allow-all egress
   rule to every security group at creation; Terraform revokes it only because
   `aws_security_group.database` is declared with no inline `egress` block. A mocked plan never
   sees AWS's implicit rule. If egress appears in this plan, the database's outbound isolation
   is not met regardless of what the test suite reports.
2. **The default security group must show no ingress and no egress.** Its rule sets are
   computed attributes, unknown at plan time and therefore unassertable in tests.
3. **No resource outside the 19 in section 1**, and no reference to any state key other than
   `crewsafe/network/shared-dev.tfstate` — no other component's state may be touched.

Attach the plan summary and run id to the pull request.

## 6. Apply

Dispatch **Terraform State Apply** from `main`:

| Input | Value |
| --- | --- |
| `target_account_alias` | same alias as the plan |
| `terraform_component` | `network-shared-dev` |
| `plan_run_id` | the run id from section 4 |
| Confirmation | typed `APPLY <alias>` |

Expected: exactly the reviewed plan applies, in under 15 minutes.

A mismatched account, a missing or foreign `plan_run_id`, or a wrong confirmation string
aborts before any mutation.

## 7. Confirm idempotency

Re-dispatch **Terraform State Plan** with the same inputs.

Expected: **"No changes."** This confirms the published outputs are stable, so consumers are
not disrupted by a re-run.

## 8. Consuming the network

The Postgres and compute components read this component's outputs from remote state and must
never hardcode an identifier or reference an internal resource address.

```hcl
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-<account-id>-ap-southeast-1"
    key    = "crewsafe/network/shared-dev.tfstate"
    region = "ap-southeast-1"
  }
}
```

| Output | Use |
| --- | --- |
| `vpc_id` | load balancer, target groups |
| `public_subnet_ids` | public load balancer |
| `private_subnet_ids` | RDS subnet group; Fargate tasks |
| `app_security_group_id` | attach to backend tasks — membership grants database access |
| `database_security_group_id` | attach to the PostgreSQL instance |

Both subnet lists are ordered to follow `var.availability_zones`, so index 0 of each is the
same availability zone.

**Two things this network cannot enforce, which the consuming issues must:**

- The Postgres component **must** set `publicly_accessible = false`. A publicly accessible
  RDS instance in a private subnet still gets a public endpoint, and no rule here stops it.
- The database **must** listen on 5432. The ingress rule admits only that port; another port
  yields a silently unreachable database.

## 9. Destroy

**Not available.** The catalogue sets `allow_destroy: false`, so the resolver refuses a
destroy dispatch for this component. This is deliberate: the database and compute components
depend on this network.

Removing it means changing the catalogue entry in a reviewed pull request, after confirming
nothing depends on it — not a workflow dispatch.

## 10. Operational notes and known limitations

**Egress is not zone-redundant.** One NAT gateway lives in `ap-southeast-1a`. Losing that zone
removes outbound internet access for the entire private tier until the gateway is recreated,
even though the `ap-southeast-1b` subnets survive and inbound service through a load balancer
is unaffected. This was accepted to halve the recurring cost. Symptom: tasks in the private
tier cannot pull images or reach external APIs, while intra-VPC traffic still works.

**The database's protection is the security group alone.** The two-tier topology means there
is no routing barrier behind it. Any change to
`aws_vpc_security_group_ingress_rule.database_from_app` — particularly substituting a
`cidr_ipv4` for the `referenced_security_group_id` — removes the only inbound control. The
test suite catches this, and it has been verified to catch it.

**Address space.** `cidrsubnet` indices 0–1 are public and 10–11 private. Indices 2–9 and 12+
are free, so either tier can grow without renumbering the other.

**Adding a fourth component later**: `test-component-catalog.sh` pins the exact catalogue key
set, so it needs a one-line update. That is expected, not a broken test.
