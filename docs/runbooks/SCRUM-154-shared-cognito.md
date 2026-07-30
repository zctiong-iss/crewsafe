# SCRUM-154 Shared Cognito Runbook

This runbook governs the `cognito-shared-dev` component. Terraform runs only in
GitHub Actions. Never use a workstation AWS profile, `terraform init`, plan, or
apply.

Related decisions and prerequisites:

- [ADR 0002 — Cookie-free bearer authentication](../adr/0002-cookie-free-bearer-authentication.md)
- [ADR 0004 — AWS Cognito for authentication](../adr/0004-aws-cognito-for-authentication.md)
- [ADR 0005 — Browser token storage](../adr/0005-browser-token-storage.md)
- [ADR 0006 — Shared remote Cognito for development](../adr/0006-shared-remote-cognito-for-development.md)
- [SCRUM-155 state-backend runbook](SCRUM-155-terraform-state-backend.md)

## 1. Account onboarding

1. Complete the SCRUM-155 backend runbook for the selected account alias.
2. Confirm the exact GitHub main-branch OIDC `sub`; store the non-wildcard value
   as repository variable `CREWSAFE_GITHUB_OIDC_MAIN_SUBJECT`.
3. Attach the reviewed policies from
   `infra/terraform/cognito/iam/{plan-role-policy,apply-role-policy}.json` to
   that account's existing plan/apply roles.
4. Add the alias to `CREWSAFE_AWS_ACCOUNTS_JSON`. Do not add credentials.
5. Add explicitly approved lowercase GitHub actors to
   `.github/cognito/admins.json` through review.

## 2. Plan and apply

If validation reports that
`infra/terraform/cognito/.terraform.lock.hcl` is missing, download the
`terraform-provider-lock-cognito` artifact from that run, verify the SHA-256
shown in the job output, and stage the file on the feature branch. The artifact
expires after one day. Do not generate or modify the lock file locally.

1. Merge the reviewed workflow/IaC files to `main`.
2. Dispatch **Terraform Plan** from `main` with alias,
   `cognito-shared-dev`, and `apply`.
3. Review account, Region, root, state key, operation, plan output, hashes, and
   expiry. Record its run ID and attempt.
4. Dispatch **Terraform Apply** with the same values and exact confirmation:
   `APPLY <alias> cognito-shared-dev`.
5. Apply downloads and validates the exact saved plan; it never replans.
6. Run another plan and verify no changes.

## 3. Publish non-sensitive configuration

Set repository variable `CREWSAFE_SHARED_COGNITO_JSON` using the versioned
schema `.github/cognito/shared-config.schema.json`. Include pool, issuer, JWKS,
Hosted UI and public client identifiers plus synthetic/non-sensitive local
application mappings. Never include email, passwords, tokens or credentials.

## 4. Minimal-Console onboarding

1. In the selected pool, the account owner completes one **Create user** form
   with the approved developer's email. Allow Cognito to generate and send the
   30-day temporary password.
2. Run **Cognito User Administration** `list-users` on `main`. Identify the new
   `FORCE_CHANGE_PASSWORD` entry using only creation time and `sub`.
3. Add its non-sensitive `sub` mapping to
   `CREWSAFE_SHARED_COGNITO_JSON`.
4. Run `add-to-group` for `developers` with confirmation
   `add-to-group <alias> <sub>`.
5. The developer signs in and changes the password; the operator never handles
   it.
6. Only if delivery fails or 30 days expire, use **Resend invitation** in the
   Console. Do not grant `AdminCreateUser` to GitHub.

## 5. Developer verification

From a fresh clone:

```bash
gh auth status
./run.sh --account <alias>
```

Verify managed login, `/api/v1/me`, expected role/sites, unknown-sub denial,
and that neither Terraform, AWS credentials nor local Cognito is required.
Two developers other than the implementer must repeat this journey.

## 6. Administration and offboarding

Allowed operations are inspect/list, enable/disable, reset-password, global
sign-out, and membership changes for `developers` and
`synthetic-test-users`. State changes require the exact workflow confirmation.

Offboard in this order:

1. Remove or disable the CrewSafe database mapping.
2. Disable the Cognito identity.
3. Globally sign it out.
4. Remove both group memberships.
5. Verify the next `/api/v1/me` request is denied.

Never permanently delete the identity through repository automation.

## 7. Account switching

Select a different registered alias in every plan/apply/admin dispatch and in
`run.sh`. Accounts have different buckets, roles, pools, and state. Never copy
or migrate Cognito state or user data between teammates' accounts.

## 8. Audit and recovery

Correlate the sanitized GitHub run ID/actor/operation/result with CloudTrail
events from `cognito-idp.amazonaws.com`. Do not copy CloudTrail request fields
containing attributes into Jira.

- Stale, changed or reused plan: discard and create a new reviewed plan.
- Backend or lock failure: follow the SCRUM-155 runbook; do not force-unlock
  without confirming ownership.
- Partial apply: stop, inspect AWS and remote state read-only, then review an
  import/reconciliation plan.
- Issuer/JWKS failure: stop authentication testing and retry after service
  recovery; do not switch to a local issuer.
- Administration failure: inspect the sanitized result and CloudTrail, refresh
  current user state, then dispatch a new operation.

Operators must identify a safe recovery action within 30 minutes.

## 9. Periodic access review

Once a month and before account handoff, an allowlisted operator runs
`list-users` and `list-groups`, then compares only immutable `sub`, status,
creation time and approved group names with `.github/cognito/admins.json` and
the current non-sensitive application mappings. Confirm every enabled
developer still needs access and every group membership is approved.

For stale or unexplained identities, follow the offboarding order in section 6;
do not delete them. Record the workflow run ID, reviewer, alias, counts,
decisions and CloudTrail correlation time without copying email, attributes,
tokens, credentials or request payloads. Review and remove obsolete GitHub
actors from `.github/cognito/admins.json` in the same change.

## 10. Add a Terraform component

Register a future root in `.github/terraform/components.json`; do not copy the
three Terraform workflows. Each entry has exactly these fields:

- `jira_key`: owning reviewed issue;
- `root`: repository-relative deployable root below `infra/terraform/`;
- `backend_strategy`: `self-bootstrap` only for the state backend, otherwise
  `remote`;
- `state_key`: unique `crewsafe/...tfstate` key;
- `allow_destroy`: explicit destroy eligibility.

The root must contain reviewed Terraform and a committed provider lock. If a
new root needs a CI-generated lock, add a narrowly scoped generation case like
the Cognito one and commit the reviewed artifact. Update the validation path
filter only when the root lies outside the existing `infra/terraform/**`
boundary. Required-check rules must not make the path-filtered workflow
mandatory for unrelated pull requests.

Catalog data cannot contain role ARNs, variable files, commands, or shell
fragments. Validation rejects malformed entries, duplicate state keys,
uncatalogued roots, traversal, symlink escape, missing locks, and unapproved
destroy. Remote components must use the selected account's SCRUM-155 backend;
state is never shared between aliases.

## 11. Timing and recovery evidence

Use GitHub run timestamps and a monotonic local timer; record only elapsed
seconds and sanitized results:

```bash
time gh variable get CREWSAFE_SHARED_COGNITO_JSON --json value --jq '.value | length > 0'
time curl -fsS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer <redacted>" http://localhost:8080/api/v1/me
```

For administration, subtract the job start time from the successful
allowlisted-operation step completion time. For a controlled invalid alias,
stale plan, or unavailable issuer exercise, record the time from the first
sanitized failure to a documented safe decision: retry, re-plan, wait for
service recovery, or reconcile state. Never insert a real token into committed
evidence or shell history; `<redacted>` denotes an ephemeral test value
supplied by the tester's secure session.

Targets:

- shared configuration retrieval completes within 30 seconds;
- an authenticated `/api/v1/me` request completes within one second in the
  representative local setup, excluding interactive login;
- an allowed administration workflow completes within five minutes, excluding
  GitHub queue time;
- an operator selects and records a safe recovery action within 30 minutes.

Record date, actor, alias, run URL or commit, measured duration, outcome, and
recovery choice in the SCRUM-154 evidence. Repeat three times where practical
and retain the slowest result. Do not record PII, credentials, tokens, full AWS
account IDs, state, plan contents, or CloudTrail request payloads.

## 12. Controlled teardown

Confirm no developer depends on the pool. First review/apply a change setting
deletion protection inactive. Then generate a separate destroy plan and use
`DESTROY <alias> cognito-shared-dev`. Remove stale repository configuration
only after the reviewed destroy succeeds.

## 13. Acceptance evidence

Record workflow URLs, commit SHA, alias, component, test/scan results, timing
and pass/fail outcomes. Do not record email, password, token, full account ID,
state, saved plan or CloudTrail request payload.

Use one copy per independent developer:

```text
Tester:
Date:
Commit SHA:
Account alias:
Configuration retrieval seconds:
Application startup: PASS/FAIL
Managed login: PASS/FAIL
/api/v1/me seconds and result: PASS/FAIL
Unknown-sub denial: PASS/FAIL
Cross-site denial: PASS/FAIL
Relevant workflow run IDs:
Recovery exercise and decision time:
Notes (sanitized):
```
