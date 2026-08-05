# Web Image ECR Registry Runbook

**Jira**: SCRUM-253 (subtask of SCRUM-142) · **Reference**: SCRUM-192
**Component**: `ecr-shared-dev` · **Root**: `infra/terraform/ecr`
**State key**: `crewsafe/ecr/shared-dev.tfstate` · **Destroy**: refused

> Never run Terraform or make AWS mutations from a workstation. Use the repository's CI-only
> Terraform Validation, Terraform State Plan, and Terraform State Apply workflows.

## 1. Resource delta

SCRUM-192's applied baseline contains four backend resources. SCRUM-253 adds exactly four:

| Resource | Address / name | Purpose |
| --- | --- | --- |
| ECR repository | `aws_ecr_repository.web` / `crewsafe/web` | Immutable, scan-on-push web image store |
| Lifecycle policy | `aws_ecr_lifecycle_policy.web` | Expire untagged images after 1 day; retain newest 20 |
| IAM role | `aws_iam_role.web_ecr_push` / `crewsafe-shared-dev-ecr-web-push` | Dedicated future web publisher identity |
| Inline policy | `aws_iam_role_policy.web_ecr_push` | Exact web push boundary plus token authentication |

Expected plan: **4 to add, 0 to change, 0 to destroy**. Any backend change, replacement, destroy,
wildcard web resource, or additional workflow/frontend resource blocks approval.

## 2. Before planning

1. Merge the reviewed branch to `main`; the plan/apply workflows intentionally check out `main`.
2. Confirm `ecr-shared-dev` remains registered with state key
   `crewsafe/ecr/shared-dev.tfstate` and `allow_destroy: false`.
3. Attach the reviewed `CrewSafeEcrTerraformPlan` and `CrewSafeEcrTerraformApply` inline policies
   to the shared Terraform plan/apply roles. The apply document is
   [`infra/terraform/ecr/iam/apply-role-policy.json`](../../infra/terraform/ecr/iam/apply-role-policy.json).
4. Substitute the target account's twelve-digit ID for every `<ACCOUNT_ID>` placeholder. Confirm
   the web statements use only the exact web repository ARN and exact web role ARN.

The plan role remains read-only. It gains no create, update, or delete permission.

## 3. CI validation

On the pull request, `Terraform Validation` must pass formatting, provider validation, mocked
Terraform tests, catalog/source guards, workflow guards, secret scanning, and applicable
configuration scans. Terraform commands are run by CI only; no local state or saved plan is valid
evidence.

## 4. Plan and apply

Dispatch **Terraform State Plan** from `main` with:

| Input | Value |
| --- | --- |
| `target_account_alias` | approved shared-dev alias |
| `terraform_component` | `ecr-shared-dev` |
| `operation` | `plan` |

Record the successful plan run ID and URL here before apply:

```text
Plan run: PENDING CI DISPATCH
Plan URL: PENDING CI DISPATCH
```

Review the four-resource delta, account precondition, exact OIDC subject, immutable/scan settings,
lifecycle rules, and exact IAM resources. Then dispatch **Terraform State Apply** with that plan run
ID and the required typed `APPLY <alias>` confirmation. Record the apply evidence:

```text
Apply run: PENDING CI DISPATCH
Apply URL: PENDING CI DISPATCH
```

## 5. Post-apply contract verification

Verify through CI outputs or approved read-only AWS checks:

- `web_repository_url` ends in `/crewsafe/web` and `web_repository_arn` names the same repository.
- Web tags are immutable and scan-on-push is enabled.
- The lifecycle policy expires untagged images after one day and retains the newest 20 images.
- `web_push_role_arn` names `crewsafe-shared-dev-ecr-web-push`.
- Trust is limited to the GitHub OIDC provider, `sts.amazonaws.com`, and the exact `main` subject.
- Repository-scoped push actions name only `web_repository_arn`; the token action is the sole `*` grant.
- The future runtime pull grant uses `web_repository_arn` and read actions only; it receives no push,
  delete, lifecycle, repository-management, or Terraform permission.

## 6. Recovery and no-destroy controls

- If validation or plan fails, do not apply. Correct the branch, rerun CI, and obtain a new plan ID.
- If AWS or CI is unavailable, leave the run pending/failed with its run identifier and retry through
  the approved workflow after recovery.
- Do not manually delete, recreate, or rename either ECR repository or IAM role.
- `allow_destroy: false` and the component resolver refuse destroy dispatches. Rollback means
  reverting the reviewed code and applying a new reviewed plan; it does not mean deleting the
  registry that future deployments may depend on.
- A final no-change convergence plan is required before closing SCRUM-253.

## 7. Operator state and scope boundary

This is infrastructure-only and changes no application UI or accessibility claim. Review evidence
must text-label the operator states: loading, empty, success, validation, offline, stale, denied,
and error. No state may be conveyed by colour alone. Web build, publication, runtime pull smoke
tests, deployment rollout, and UI verification belong to the follow-up workflow/runtime issues.

## 8. Evidence ledger

| Evidence | Status |
| --- | --- |
| Local `git diff --check` and shell/source guards | Pending implementation validation |
| CI Terraform fmt/validate/test | Pending CI run |
| Reviewed `ecr-shared-dev` plan | Pending CI dispatch |
| Apply and outputs | Pending approved apply |
| Final no-change convergence plan | Pending apply |
