# Runbook — Compute S3 authorization recovery (SCRUM-451)

This runbook restores the permissions needed by `compute-shared-dev` to manage
its S3 buckets and access-log configuration. It is linked to SCRUM-444 because
the missing permission blocked the staging lightning-ingestion rollout.

**Policy component**: `iam-policy-management-shared-dev`  
**Infrastructure component**: `compute-shared-dev`  
**Policy root**: `infra/terraform/iam-policy-management`  
**Compute root**: `infra/terraform/compute`  
**State-backend**: explicitly out of scope

Never run Terraform locally, configure a workstation AWS profile, download
state, or reuse a saved plan after this policy changes. All plan and apply
operations use GitHub Actions, OIDC, remote state, and a newly reviewed plan.

## 1. Diagnosis and scope

The failed staging apply authenticated successfully but received an AWS
`AccessDenied` for `s3:CreateBucket` while creating compute-managed access-log
bucket resources. The failure was in the normal compute apply role's attached
permissions; it was not a `state-backend` failure and it was not caused by the
application, SSE, SSE stream, or lightning-ingestion code.

The fix adds two centrally managed policies:

- `compute-s3-plan`: read/discovery access for the four compute buckets.
- `compute-s3-apply`: the same reads plus explicit bucket-management actions.

The exact resource set is:

```text
arn:aws:s3:::crewsafe-shared-dev-web
arn:aws:s3:::crewsafe-shared-dev-alb-logs
arn:aws:s3:::crewsafe-shared-dev-web-logs
arn:aws:s3:::crewsafe-shared-dev-cloudfront-logs
```

No object-level access or wildcard S3 action is part of the fix. The only
resource wildcard is the account-level `s3:ListAllMyBuckets` discovery
permission.

## 2. Preconditions

Before dispatching anything:

1. Confirm the SCRUM-451 pull request is merged to `main`. The Terraform workflows reject non-main plan/apply runs.
2. Confirm the target account alias is registered in `CREWSAFE_AWS_ACCOUNTS_JSON`.
3. Confirm the pull request checks passed, including IAM policy contract tests and source guards.
4. Confirm no unrelated changes to `state-backend`, application code, SSE, or legacy `infra/terraform/compute/iam/*.json` are included.
5. Record the pull request SHA and the Jira links for SCRUM-451 and SCRUM-444.

## 3. Apply policy-management first

Generate a policy-management plan from `main`:

```bash
gh workflow run "Terraform State Plan" \
  --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=iam-policy-management-shared-dev \
  -f operation=apply
```

Record the successful plan run ID and attempt. Review the plan artifact and
confirm:

- exactly 20 customer-managed policy bindings and 20 explicit attachments;
- only `compute-s3-plan` and `compute-s3-apply` are new or changed;
- the policies attach to the existing normal Terraform plan/apply roles;
- the S3 statements contain only the four named buckets and the documented discovery exception;
- no wildcard S3 action, object action, state-backend resource, or unrelated policy change appears.

Apply that exact reviewed policy plan from `main`:

```bash
gh workflow run "Terraform State Apply" \
  --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=iam-policy-management-shared-dev \
  -f operation=apply \
  -f plan_run_id=<policy-plan-run-id> \
  -f plan_run_attempt=<policy-plan-run-attempt> \
  -f confirmation="APPLY <alias> iam-policy-management-shared-dev"
```

Do not continue if the policy apply fails, targets the wrong account or role
family, or reports a policy outside the reviewed boundary.

## 4. Generate and apply a fresh compute plan

The earlier failed compute plan is stale because the authorization boundary has
changed. Generate a new plan only after the policy-management apply succeeds:

```bash
gh workflow run "Terraform State Plan" \
  --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=compute-shared-dev \
  -f operation=apply
```

Review the new plan and record its run ID and attempt. Confirm that it targets
the intended account and `compute-shared-dev` state key, and that the plan
contains the expected S3 bucket/configuration resources without unrelated
state-backend or application changes.

Apply only that fresh reviewed plan:

```bash
gh workflow run "Terraform State Apply" \
  --ref main \
  -f target_account_alias=<alias> \
  -f terraform_component=compute-shared-dev \
  -f operation=apply \
  -f plan_run_id=<compute-plan-run-id> \
  -f plan_run_attempt=<compute-plan-run-attempt> \
  -f confirmation="APPLY <alias> compute-shared-dev"
```

## 5. Verify and record evidence

The recovery is successful only when the CI apply completes and its evidence
shows:

- the four managed S3 buckets and bucket configuration resources converge;
- no `s3:CreateBucket` or related managed-bucket authorization denial remains;
- the reviewed plan was applied once and the workflow records the intended account, component, source revision, run ID, and attempt;
- no local credentials, state, saved plan, or secret appears in the logs or artifacts;
- SCRUM-451 is updated with the policy-management and fresh compute plan/apply links;
- SCRUM-444 remains blocked until its own acceptance checks, including lightning readings, pass.

## 6. Failure, partial apply, and rollback

If the fresh compute plan or apply reports another authorization failure:

1. Stop the rollout and preserve the failed workflow links and denied action.
2. Do not add `s3:*`, an account-wide bucket wildcard, or object access as a workaround.
3. Do not reuse the failed or superseded plan.
4. Determine whether the missing capability is within the approved compute resource inventory; if not, open a separately reviewed Jira change.
5. If resources partially changed, generate a new reviewed compute plan from remote state. Do not manually edit, import, delete, push, or repair Terraform state as an unreviewed workaround.

If the policy change itself must be reverted, revert the reviewed source change
through a pull request, merge the reviewed revert to `main`, and repeat the
policy-management plan/apply process with a fresh plan. Do not run a destroy
operation or use `state-backend` for this incident.

## 7. Related records

- Jira: [SCRUM-451](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-451)
- Blocked rollout: [SCRUM-444](https://u-team-h6ii4x03.atlassian.net/browse/SCRUM-444)
- Authoritative policy-management runbook: [SCRUM-265 Terraform IAM policy management](SCRUM-265-terraform-iam-policy-management.md)
