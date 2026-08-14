# SCRUM-372 Developer Read-Only IAM Console Access Runbook

**Component**: `developer-access-shared-dev` · **Root**: `infra/terraform/developer-access` ·
**State key**: `crewsafe/developer-access/shared-dev.tfstate` · **Destroy**: refused
(`allow_destroy: false`)

**Plan**: [SCRUM-372-developer-readonly-iam-users-plan.md](../plans/SCRUM-372-developer-readonly-iam-users-plan.md)

This runbook covers attaching the IAM policies, onboarding and offboarding developers,
resetting a forgotten password, rotating a CLI access key, and what a leaked credential
requires.

> **Never run Terraform against a real account from a workstation** (`AGENTS.md` §3).
> Everything that touches AWS here is a CI dispatch.

## 1. What this component creates

| Resource | Count | Note |
| --- | --- | --- |
| IAM group | 1 | `crewsafe-developers` |
| IAM group policy (inline) | 1 | Scoped read-only — `ecs:List*`/`Describe*`, `rds:DescribeDBInstances`, `ec2:Describe*`, `logs:DescribeLogGroups`, `logs:GetLogEvents`/`FilterLogEvents`, `secretsmanager:ListSecrets`/`DescribeSecret` — never a write action, never `secretsmanager:GetSecretValue` |
| IAM user | N | One per developer in `developers.auto.tfvars`, path `/crewsafe/developers/` |
| IAM login profile | N | Console password, reset required at first sign-in |
| IAM access key | N | CLI credential |
| IAM group membership | N | Non-exclusive, one per user |

**No MFA** — explicitly out of scope for this component (Clarifications, 2026-08-14). The
read-only policy's own narrow scope is the only safeguard against a compromised credential.

## 2. Prerequisites and sequencing

1. Merge the PR registering this component (`contracts/component-registration.md` in the
   feature's spec directory).
2. Attach the two hand-applied IAM policies (§3) — **before** the first plan, or it fails on
   `AccessDenied`.
3. Confirm `developers.auto.tfvars` reflects the current team roster and has been reviewed in
   the same PR.
4. Dispatch plan, review, apply (§4).
5. Verify (§7).

## 3. Grant the CI roles their permissions — via `iam-policy-management`, not hand-applied

Unlike the older components (SCRUM-173/174/175/176), this component's plan/apply permissions
are **not** hand-attached inline policies. They are managed by the existing
`iam-policy-management-shared-dev` component (SCRUM-265), which creates a customer-managed IAM
policy per role and attaches it via `aws_iam_role_policy_attachment` — fully Terraform-managed,
no console click-ops.

This repository's implementation already registers `developer-access` in
`infra/terraform/iam-policy-management/main.tf`'s `locals.components`, with its policy documents
at `infra/terraform/iam-policy-management/policies/developer-access/{plan,apply}.json.tftpl`
(identical content to this component's own `iam/*.json` files, kept in sync — the latter is the
authored/reviewed original, the former the applied copy, the same relationship every other
component managed by `iam-policy-management` already has).

**What's left is dispatching `iam-policy-management-shared-dev`'s own plan and apply** — a
normal CI dispatch of an already-existing, already-approved component, not a new manual step:

1. **Actions → Terraform State Plan**, `terraform_component: iam-policy-management-shared-dev`.
2. Expect **2 to add** — one new `aws_iam_policy` and one new `aws_iam_role_policy_attachment`,
   both for `developer-access-apply`... and the matching pair for `-plan`, so **4 to add** in
   total (2 policies + 2 attachments). No existing binding should show as changed.
3. Review, then **Actions → Terraform State Apply**.

This sidesteps the inline-policy character-budget question entirely — customer-managed policies
have their own separate 6,144-character-per-policy limit, nowhere near what either of this
component's two short policies need, and `iam-policy-management`'s dedicated apply role's
bootstrap permissions are already scoped generically by IAM path
(`.../crewsafe/terraform/iam-policy-management/*`), not to a fixed policy count — no external
re-bootstrap was needed to add this ninth component.

Do the `developer-access-shared-dev` dispatch (§4) only **after** this step — its own first plan
would otherwise fail on `AccessDenied`.

## 4. Dispatch plan and apply

1. **Actions → Terraform State Plan → Run workflow** (from `main`).
2. `target_account_alias`: your alias. `terraform_component`: `developer-access-shared-dev`.
3. Expect `2 + 4N` to add on a first run, where `N` is the number of entries in
   `developers.auto.tfvars`.
4. Review the plan by hand:
   - [ ] No statement in the group policy contains a create/update/delete action.
   - [ ] No statement grants `secretsmanager:GetSecretValue`.
   - [ ] Every `aws_iam_user` shows `path = "/crewsafe/developers/"`.
   - [ ] Every `aws_iam_user_login_profile` shows `password_reset_required = true`.
   - [ ] The plan is additions only for a first run — a `must be replaced` on an existing
     developer's resources would silently issue them a new password/key.
5. **Actions → Terraform State Apply**, with the plan's run id and typed `APPLY <alias>`.
6. Retrieve each new developer's password and access-key secret from the apply output —
   available once, at creation. Deliver both out of band. **Never** paste either into Jira,
   Slack, or a commit.

## 5. Onboard a new developer

1. Add one entry to `infra/terraform/developer-access/developers.auto.tfvars`:

   ```hcl
   developers = [
     { username = "existing-dev" },
     { username = "new-dev" },
   ]
   ```

2. Open a PR. This is a reviewable, one-line diff — the entire point of sourcing the roster
   from a committed file rather than a CI dispatch input (research.md R-003).
3. Merge, then dispatch plan. **Expect exactly 4 to add** — the new developer's user, login
   profile, access key, and group membership — and zero changes to the group, the policy, or
   any existing developer.
4. Review per §4, apply, and deliver the new developer's password and access-key secret out of
   band, together with the instructions below (§5.1).

### 5.1 What to send the developer

Send this alongside their password and access-key secret — never the credentials alone, and
never both in the same message as this template if your delivery channel logs message history
(e.g., paste the template in one message, the credentials in a second, ephemeral one).

```text
Subject: Your CrewSafe AWS access (read-only)

You've been given individual, read-only access to the CrewSafe AWS account for
troubleshooting and visibility — no more sharing the root login.

CONSOLE ACCESS
1. Sign in: https://669958787600.signin.aws.amazon.com/console
   IAM user name: <username>
   Temporary password: [sent separately]
2. You'll be forced to set a new password on first sign-in. Pick one only you know —
   nobody else has it, including whoever set this up.
3. Once in, check out ECS, RDS, VPC, and CloudWatch Logs — you'll see this project's
   crewsafe-shared-dev resources.

CLI ACCESS
1. Run: aws configure --profile crewsafe-shared-dev
2. Enter the access key ID and secret access key [sent separately], region
   ap-southeast-1, output format json.
3. Try it: aws sts get-caller-identity --profile crewsafe-shared-dev
   aws ecs list-services --cluster crewsafe-shared-dev --profile crewsafe-shared-dev

WHAT YOU CAN AND CAN'T DO
- Read-only. You can list and describe ECS, RDS, VPC, CloudWatch Logs, and
  Secrets Manager metadata for this project.
- You cannot create, change, or delete anything — every write attempt is denied.
- You cannot read any secret value (e.g. the database password) — that's separate,
  narrower access for a different purpose, not part of this grant.
- No MFA is required for this account (a deliberate choice, not an oversight) — treat
  your password and access key with the same care as any standing credential. Don't
  commit the access key anywhere, don't share it, don't paste it into a chat log.

IF SOMETHING'S WRONG
- Forgot your password, or think your access key leaked: ping <admin>, don't try to
  self-serve — both need an admin action.
- Questions about what you're allowed to do or see: this is deliberately narrow scope;
  if you need more (e.g. actually connecting to the database), that's a separate,
  further-scoped request, not something to route around.
```

## 6. Offboard a departing developer

1. Remove that developer's entry from `developers.auto.tfvars`. Open a PR, merge.
2. Dispatch plan. **Expect exactly 4 to destroy** — that developer's user, login profile,
   access key, and group membership. If any other developer's resources appear in the plan,
   **stop and do not apply** — the roster edit was not isolated to the intended entry.
3. Apply.
4. **This does not instantly end an already-open console session.** IAM changes take effect
   immediately for *new* authorization checks, but an AWS session token already issued to that
   developer remains valid until it naturally expires. There is no faster revocation path
   available here — state this to whoever asks whether offboarding is "immediate."

## 7. Verify after apply

- All four outputs resolve (`developer_group_name`, `developer_group_arn`,
  `developer_user_names`, `developer_user_arns`).
- A developer signs into the AWS Console with the delivered password, is forced through a
  password reset, and can browse ECS/RDS/VPC/CloudWatch resources for this project.
- The same developer, using their CLI access key, can run a read command (e.g.
  `aws rds describe-db-instances`) successfully.
- The same developer's attempt at any write action (console or CLI) and at
  `secretsmanager:GetSecretValue` is denied.
- **Re-run the plan once more. Expect no changes** — proves the definition is idempotent.

## 8. Reset a forgotten password

No Terraform change. An administrator with IAM console access resets the developer's login
profile directly:

```bash
aws iam update-login-profile --user-name <username> --password '<new-temporary-password>' --password-reset-required
```

Deliver the new temporary password out of band, the same as at onboarding. The
`--password-reset-required` flag re-forces a change at next sign-in, so the value handed over
here is never a standing credential either.

## 9. Rotate a CLI access key

Also no Terraform change — Terraform created the *first* key, but ongoing rotation is an
operational action, not a redeploy:

1. Create a second key for the user: `aws iam create-access-key --user-name <username>`.
2. Deliver the new key/secret out of band.
3. Once the developer confirms the new key works, deactivate and delete the old one:

   ```bash
   aws iam update-access-key --user-name <username> --access-key-id <old-key-id> --status Inactive
   aws iam delete-access-key --user-name <username> --access-key-id <old-key-id>
   ```

**If a key is exposed** (committed to a personal repo, pasted somewhere public), skip step 1's
grace period — deactivate the exposed key immediately, then issue a replacement. A recreated key
gets a **new** secret; the old one cannot be recovered or reused.

## 10. Destroy

**Refused.** `allow_destroy: false` in the component catalogue refuses the dispatch. A roster
shrinking to zero developers still leaves the group and policy in place — removing them
entirely is a deliberate, separate catalogue change, not an incidental side effect of an empty
roster.
