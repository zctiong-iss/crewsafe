# ECR Shared-Dev Runbook

**Component**: `ecr-shared-dev` · **Root**: `infra/terraform/ecr` · **State key**:
`crewsafe/ecr/shared-dev.tfstate` · **Destroy**: refused (`allow_destroy: false`)

**ADR**: [0007-container-registry-ecr-over-ghcr.md](../adr/0007-container-registry-ecr-over-ghcr.md)

> **Known gap — placeholder Jira key.** `SCRUM-999999` is not a real Jira issue. It exists
> only because `components.schema.json` requires `jira_key` to match `^SCRUM-[0-9]+$`, and no
> infra ticket for this component existed when it was built (SCRUM-177 is the CI pipeline that
> *consumes* this registry, not the registry itself; a Jira search confirmed no registry ticket
> exists as of 2026-08-02). **Once a real ticket is created**, update all of: this file's name
> and header, the `Jira` tag in `infra/terraform/ecr/versions.tf`, and the `jira_key` in
> `.github/terraform/components.json`.

> **Never run Terraform against a real account from a workstation.** Everything that touches
> AWS here is either a CI dispatch or a single scoped AWS CLI call / Console action.

## 1. What this procedure creates

| Resource | Count | Note |
| --- | --- | --- |
| ECR repository | 1 | `crewsafe/backend` |
| ECR lifecycle policy | 1 | Expires untagged images after 1 day; keeps newest 20 |
| IAM role | 1 | `crewsafe-shared-dev-ecr-push` |
| Inline role policy | 1 | Push + `GetAuthorizationToken` only |

**4 resources.** No pull role — SCRUM-176's compute component reads the existing
`crewsafe/*`-scoped pull grant already on the `secrets-shared-dev` task-execution role.

## 2. Prerequisites and sequencing

### The component must be on `main` first

`Terraform Plan` and `Terraform Apply` both run `if: github.ref == 'refs/heads/main'` and check
out the default branch. A component on a feature branch is invisible to them.

### Order of operations

1. Merge the pull request registering the component (adds `ecr-shared-dev` to
   `components.json`, updates `test-component-catalog.sh`, and commits the generated
   `.terraform.lock.hcl` — the lockfile-generation step in `terraform-validate.yml` covers the
   `cognito` component only, so it must already be present in the PR or CI fails outright).
2. Attach the IAM policies (§3) — **before** the first plan, or it fails on `AccessDenied`.
3. This component has no `terraform_remote_state` dependency on any other component. It can be
   applied independently of `network`, `secrets`, or `cognito`.
4. Dispatch plan (§4), review (§5), apply (§6).
5. Set the two repository variables the new backend CI workflow reads (§7).

### Also required

- The account alias must be registered in `CREWSAFE_AWS_ACCOUNTS_JSON`.
- The state bucket `crewsafe-terraform-state-<ACCOUNT_ID>-ap-southeast-1` must exist.

## 3. Attach the IAM policies

These are hand-applied documents, not Terraform-managed resources — the same manual step every
other component's runbook describes.

| Role | Inline policy name | Document |
| --- | --- | --- |
| `CrewSafeGitHubTerraformPlanRole` | `CrewSafeEcrTerraformPlan` | [`iam/plan-role-policy.json`](../../infra/terraform/ecr/iam/plan-role-policy.json) |
| `CrewSafeGitHubTerraformApplyRole` | `CrewSafeEcrTerraformApply` | [`iam/apply-role-policy.json`](../../infra/terraform/ecr/iam/apply-role-policy.json) |

> **The policy name is load-bearing. Get it exactly right.** Attaching an inline policy is an
> **upsert**: saving one whose name already exists silently *replaces* it, with no warning and no
> error. Both roles are shared across every component and already carry the Cognito, network,
> and secrets policies. Reusing one of those names here deletes that component's permissions, and
> the damage surfaces later as an unrelated-looking `AccessDenied` on *its* next plan.

Replace `<ACCOUNT_ID>` in the apply policy with the target account's twelve-digit id before
attaching. It appears twice: once in `ManageEcrRepository`'s resource, once in
`ManagePushRoleIdentity`'s.

### 3.1 Update the plan role

1. In the AWS Console, open **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformPlanRole`.
3. **Permissions → Add permissions → Create inline policy** → JSON editor.
4. Copy the complete reviewed document from `infra/terraform/ecr/iam/plan-role-policy.json`.
5. Confirm it contains only `Describe`/`Get`/`List` actions — no create, update, or delete.
6. Name the policy `CrewSafeEcrTerraformPlan`. Save.

### 3.2 Update the apply role

1. Return to **IAM → Roles**.
2. Select `CrewSafeGitHubTerraformApplyRole`.
3. **Permissions → Add permissions → Create inline policy** → JSON editor.
4. Copy the complete reviewed document from `infra/terraform/ecr/iam/apply-role-policy.json`,
   with `<ACCOUNT_ID>` substituted in both places.
5. Confirm `ManageEcrRepository` is scoped to the exact repository ARN
   (`arn:aws:ecr:ap-southeast-1:<ACCOUNT_ID>:repository/crewsafe/backend`), not `*`, and
   `ManagePushRoleIdentity` is scoped to the exact role ARN
   (`arn:aws:iam::<ACCOUNT_ID>:role/crewsafe-shared-dev-ecr-push`), not the shared
   `crewsafe-shared-dev-*` prefix other components' apply-role grants use — this component's
   push role is independently scoped rather than relying on another component's grant.
6. Name the policy `CrewSafeEcrTerraformApply`. Save.

## 4. Plan

Dispatch **Terraform Plan** from `main`:

| Input | Value |
| --- | --- |
| `target_account_alias` | the designated shared-dev alias |
| `terraform_component` | `ecr-shared-dev` |
| `operation` | `apply` |

No extra variables are needed — `expected_account_id`, `account_alias`, `aws_region`, and
`github_oidc_main_subject` all come from the account registry / the workflow's unconditional
`TF_VAR_github_oidc_main_subject`, the same way `cognito-shared-dev` gets it.

Record the **run id**; the apply workflow requires it.

## 5. Review the plan — mandatory checks

1. **4 resources to add, 0 to change, 0 to destroy.** An unexpected addition is scope creep the
   mocked tests cannot see.
2. **The repository name is exactly `crewsafe/backend`.** Anything else silently falls outside
   the `secrets-shared-dev` task-execution role's existing pull grant.
3. **The push role's trust condition names this repository's real owner/repo IDs**, not a
   placeholder — `terraform-plan.yml` supplies the real `github_oidc_main_subject` at dispatch,
   but confirm the plan output reflects it rather than a stale cached value.
4. **The account precondition resolved to the designated account.**

## 6. Apply

Dispatch **Terraform Apply** from `main` with the successful `plan_run_id` and the typed
confirmation `APPLY <alias>`. It applies exactly the reviewed plan.

## 7. Set the repository variables the backend CI workflow reads

Read `repository_url` and `push_role_arn` from the apply run's Terraform output, then in
**Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
| --- | --- |
| `CREWSAFE_ECR_REPOSITORY_URL` | the `repository_url` output |
| `CREWSAFE_ECR_PUSH_ROLE_ARN` | the `push_role_arn` output |

Until both are set, `.github/workflows/backend-ci.yml`'s `publish-image` job shows as
**skipped** on every push to `main` — not failed. The next push after both variables are set
starts publishing automatically; no workflow change is needed.

## 8. Destroy

**Refused.** `resolve-component.sh` rejects a destroy dispatch for this component before any
credential is assumed, because the backend CI pipeline pushes to this repository on every merge
to `main` and SCRUM-176's compute runtime will come to depend on images already published there.

## 9. Consuming this component

```hcl
data "terraform_remote_state" "ecr" {
  backend = "s3"
  config = {
    bucket = "crewsafe-terraform-state-${var.expected_account_id}-${var.aws_region}"
    key    = "crewsafe/ecr/shared-dev.tfstate"
    region = var.aws_region
  }
}
```

| Output | Use |
| --- | --- |
| `repository_url` | `CREWSAFE_ECR_REPOSITORY_URL`; also what SCRUM-176's task definition pulls |
| `repository_arn` | Scoping a precise pull grant, if a consumer ever needs to diverge from the `secrets-shared-dev` component's existing `crewsafe/*` pattern |
| `push_role_arn` | `CREWSAFE_ECR_PUSH_ROLE_ARN` |

### Rules a consumer must not break

| Rule | What breaks if ignored |
| --- | --- |
| Reference the pull grant already on `secrets-shared-dev`'s task-execution role; don't create a second one | Duplicated, drifting IAM boundaries for the same repository |
| Never widen `crewsafe-shared-dev-ecr-push`'s policy beyond its own repository ARN | The push role could then push to any repository under `crewsafe/*` |
| Never add this role's ARN to `CREWSAFE_AWS_ACCOUNTS_JSON` | That schema is closed to the two Terraform state-management roles (`resolve-terraform-account.sh` regex-validates exactly `plan_role_arn`/`apply_role_arn`) |

## 10. Operational notes and known limitations

- **`image_tag_mutability` is `IMMUTABLE`.** `backend-ci.yml` tags images by commit SHA only —
  there is no floating `latest`, since an immutable repository rejects a re-push of an existing
  tag. A consumer that wants "the newest image" resolves it by listing images and sorting on
  push time, not by pulling a fixed tag.
- **One statement uses `Resource: "*"`**: `ecr:GetAuthorizationToken`, which the ECR API accepts
  no resource scope for. It is held to one action in one statement, and `ecr.tftest.hcl`'s
  `iam_boundary` run asserts all three of those facts.
- **The push role trusts only `ref:refs/heads/main`.** Pull requests never push images —
  `backend-ci.yml`'s `publish-image` job only ever runs on a `push` event to `main`, and the OIDC
  trust condition enforces the same restriction independently at the AWS side.
- **The lifecycle policy is a coarse safety net, not a rollback strategy.** Twenty images is
  comfortably more than SCRUM-176 would ever need to roll back across, but is not itself the
  chosen deployment/rollback mechanism — that belongs to SCRUM-176.
