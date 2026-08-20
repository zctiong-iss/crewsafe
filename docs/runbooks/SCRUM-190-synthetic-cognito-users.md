# SCRUM-190 — Synthetic Cognito users

This runbook manages fictional demo logins in the shared development Cognito
pool. It complements
[SCRUM-154 shared Cognito](SCRUM-154-shared-cognito.md) and follows
[ADR 0006](../adr/0006-shared-remote-cognito-for-development.md).

Human/developer invitations remain AWS Console-only. Do not use this procedure
for a person, personal email address, real worker data, or production access.

## 1. How the model works

Each synthetic login has three separate parts:

1. **Cognito identity** — authenticates with a generated permanent password.
2. **`synthetic-test-users` group** — classification and audit metadata only.
3. **CrewSafe application mapping** — binds the immutable Cognito `sub` to the
   reviewed role and sites. This is the only part that grants application
   access.

The reviewed manifest is
[`.github/cognito/synthetic-users.yml`](../../.github/cognito/synthetic-users.yml).
It initially declares:

| Key | Username | CrewSafe role | Sites |
|---|---|---|---|
| `demo-worker` | `synthetic-worker@synthetic.crewsafe.invalid` | `WORKER` | `bishan` |
| `demo-supervisor` | `synthetic-supervisor@synthetic.crewsafe.invalid` | `SUPERVISOR` | `bishan`, `campus` |
| `demo-safety-manager` | `synthetic-safety-manager@synthetic.crewsafe.invalid` | `SAFETY_MANAGER` | `bishan`, `campus` |

The `.invalid` addresses are deliberately non-deliverable. Cognito invitations
are suppressed. Passwords are generated in the selected AWS account and
stored only in AWS Secrets Manager.

## 2. Preconditions

Before the first mutation, confirm all of the following:

- The implementation and the selected manifest revision are merged to
  `main`. The workflow refuses mutations from feature branches.
- The account alias exists in `CREWSAFE_AWS_ACCOUNTS_JSON`.
- The same alias exists in `CREWSAFE_SHARED_COGNITO_JSON` and points to the
  deployed `crewsafe-shared-dev` pool in `ap-southeast-1`.
- The operator's lowercase GitHub username is listed for that alias in
  [`.github/cognito/admins.json`](../../.github/cognito/admins.json).
- SCRUM-155 state infrastructure and SCRUM-154 shared Cognito have been
  successfully applied in that AWS account through the reviewed Terraform
  plan/apply workflows.
- `CrewSafeGitHubCognitoAdminRole` trusts the exact `main` OIDC subject and has
  the latest Terraform-managed policy.
- No real or personal identity uses the reserved
  `@synthetic.crewsafe.invalid` namespace.

Do not run Terraform, AWS CLI, or an AWS profile locally. All mutations in
this runbook happen through GitHub Actions; the account owner uses AWS Console
only to retrieve a generated login credential.

## 3. Review and validate a manifest change

1. Edit only non-secret fields in `synthetic-users.yml`.
2. Use a registered account alias and a unique lowercase `key`.
3. Keep `username` under `@synthetic.crewsafe.invalid`.
4. Use only `WORKER`, `SUPERVISOR`, or `SAFETY_MANAGER`.
5. Use only a `site_codes` value declared in
   [`backend/src/main/resources/cognito/known-site-codes.json`](../../backend/src/main/resources/cognito/known-site-codes.json) —
   currently `bishan` and `campus`. This file is the single source both the backend
   (`DemoDataSeeder`) and this manifest's CI guard read (SCRUM-490); a code not listed there is
   rejected by both. Adding a new site means adding it here, adding a matching site definition
   (display name and coordinates) in `DemoDataSeeder`, and only then using it in a manifest
   entry — see
   [SCRUM-490-synthetic-site-allowlist-plan.md](../plans/SCRUM-490-synthetic-site-allowlist-plan.md)
   for the full mechanism and rationale.
6. Keep `group: synthetic-test-users`.
7. Use `desired_status: enabled` or `disabled`.
8. Leave `cognito_sub` empty only before first creation. Once bound, never
   change or reuse it.
9. Open a PR. Confirm **Terraform State Validation** runs and the synthetic
   manifest, guard, IAM, shell and backend checks pass.
10. Review the credential-free summary. It must contain no password, token,
    email outside the reserved namespace, secret value, or AWS credential.

An omitted declaration is reported as unmanaged; omission does not disable or
delete anything.

## 4. First reconciliation

After the unbound manifest is merged to `main`:

1. Open the repository on GitHub.
2. Open **Actions → Cognito User Administration → Run workflow**.
3. Select branch `main`.
4. Enter:
   - `target_account_alias`: the registered alias, for example `dev`;
   - `operation`: `reconcile-synthetic`;
   - `cognito_sub`: blank;
   - `group`: blank;
   - `synthetic_key`: `all`;
   - `confirmation`: `reconcile-synthetic dev all` (replace `dev` with the
     exact selected alias).
5. Run the workflow and wait for both jobs to finish.

The workflow checks the actor, account, Region, pool, exact main revision and
manifest checksum before mutation. It creates each missing enabled identity
with `MessageAction=SUPPRESS`, sets its generated password as permanent, adds
only `synthetic-test-users`, and writes the password only to:

```text
crewsafe/<account-alias>/cognito/synthetic/<synthetic-key>
```

Expected summary for each new user:

```text
Synthetic key: <key>
Subject: <non-secret Cognito UUID>
Result: created-awaiting-binding
```

No password or secret value should appear. If it does, cancel further work,
restrict the exposed credential, rotate it, and raise a security incident.

## 5. Bind the immutable subjects

Creation is not complete until the subjects are reviewed in git:

1. Copy only each `Subject` value from the sanitized workflow summary.
2. Create a new branch from the just-applied `main`.
3. In `synthetic-users.yml`, place each value in its matching
   `cognito_sub`. Do not copy credentials or AWS account IDs.
4. Confirm each subject is UUID-shaped, unique in the selected account, and
   still matches the username shown in AWS Console.
5. Open a narrowly scoped PR linked to SCRUM-190.
6. Review and merge it to `main`.
7. Rerun section 4 with the same inputs.

Every bound identity should now report `unchanged`. The second run must not
create a user, generate or rotate a credential, add a duplicate membership,
or reactivate an identity.

An unbound identity is intentionally excluded from local CrewSafe mappings,
even if Cognito creation succeeded.

## 6. Retrieve a login credential

Only the selected AWS account owner should do this:

1. Sign in to the selected AWS account in AWS Console.
2. Open **Secrets Manager → Secrets**.
3. Search for
   `crewsafe/<alias>/cognito/synthetic/<synthetic-key>`.
4. Open the exact secret and choose **Retrieve secret value**.
5. Use the reserved manifest username and retrieved password only in the
   CrewSafe test login.
6. Do not paste the value into GitHub, Jira, chat, shell history, screenshots,
   recordings, browser automation artifacts, or a local file.
7. Close the secret view after use.

GitHub Actions deliberately cannot read this value. The workflow may create
or rotate it, but has no `secretsmanager:GetSecretValue` permission.

## 7. Test CrewSafe locally against the shared pool

No local Cognito or AWS credentials are required:

1. Ensure the subject-binding PR is merged.
2. Authenticate GitHub CLI and confirm repository-variable read access:

   ```bash
   gh auth status
   ```

3. Start with the selected account alias:

   ```bash
   # Podman
   ./run.sh --account dev

   # Docker
   ./run-docker.sh --account dev
   ```

4. Open `http://localhost:5173`.
5. In a private browser session, sign in through the normal Cognito Hosted UI
   with one reserved username and its retrieved password.
6. Verify `/api/v1/me`:
   - worker: `WORKER`, `bishan` only;
   - supervisor: `SUPERVISOR`, `bishan` and `campus`;
   - safety manager: `SAFETY_MANAGER`, `bishan` and `campus`.
7. Verify a worker cannot perform supervisor/safety-manager actions.
8. Verify a site-scoped user cannot access an undeclared site.
9. Verify an authenticated but unmapped subject is denied server-side.
10. Sign out before switching persona.

The local launcher downloads only non-sensitive configuration and constructs
the runtime mapping. It skips unbound declarations and rejects username or
subject collisions. Cognito groups do not grant roles.

## 8. Rotate one password

Rotation requires a bound, enabled declaration:

1. Open **Actions → Cognito User Administration** on `main`.
2. Enter:
   - `target_account_alias`: `<alias>`;
   - `operation`: `rotate-synthetic`;
   - `synthetic_key`: `<key>`;
   - `cognito_sub` and `group`: blank;
   - `confirmation`: `rotate-synthetic <alias> <key>`.
3. Run the workflow.
4. Confirm `Result: updated`.
5. Retrieve the replacement value through AWS Console as in section 6.
6. Confirm the old password and prior sessions no longer work, then verify
   the new password.

The workflow updates the existing secret, replaces the permanent Cognito
password and performs global sign-out. It never prints either password.

## 9. Disable one identity

1. In a reviewed PR, change that declaration to
   `desired_status: disabled`; do not remove it or change its subject.
2. Merge the PR to `main`.
3. Run **Cognito User Administration** with:
   - `operation`: `disable-synthetic`;
   - `synthetic_key`: `<key>`;
   - `confirmation`: `disable-synthetic <alias> <key>`;
   - other target fields blank.
4. Confirm `Result: disabled`.
5. Restart/redeploy the backend through its approved process so the explicit
   inactive mapping is reconciled.
6. Start a new session and confirm login/application access is denied within
   60 seconds.

Disable performs Cognito disable and global sign-out. It preserves the
identity, immutable subject and secret.

## 10. Re-enable one identity

1. In a reviewed PR, change the bound declaration to
   `desired_status: enabled`.
2. Merge the PR to `main`.
3. Run the workflow with:
   - `operation`: `enable-synthetic`;
   - `synthetic_key`: `<key>`;
   - `confirmation`: `enable-synthetic <alias> <key>`;
   - other target fields blank.
4. Confirm `Result: enabled`.
5. Restart/redeploy the backend through its approved process.
6. Start a new session and confirm the reviewed role/sites are restored
   within 60 seconds.

Enable does not rotate or reveal the stored credential.

## 11. Audit evidence

Record only:

- PR/commit SHA and manifest checksum;
- account alias (not the full account ID);
- synthetic key and reserved username;
- immutable `sub`;
- requested operation and result;
- actor, workflow run ID and timestamp;
- exact CrewSafe role/site assertions and sanitized denial outcomes;
- elapsed timings without tokens or headers.

Never record a password, secret value, JWT, refresh token, AWS credential,
personal email, full account ID, or token-bearing URL.

## 12. States and operator response

| State | Expected text/result | Response |
|---|---|---|
| Loading | GitHub job is queued/running | Wait; do not start a competing account mutation. |
| Empty | Selected account has no declarations | Treat as a valid no-op and review whether the alias is correct. |
| Success—new | `created-awaiting-binding` | Complete the binding PR before login testing. |
| Success—stable | `unchanged` | No action; this is the expected repeat result. |
| Success—lifecycle | `updated`, `enabled`, or `disabled` | Perform the matching verification step. |
| Validation | Resolver names an invalid manifest/input rule | Correct through PR review; do not bypass it. |
| Stale | Revision/checksum or immutable-sub conflict | Stop and rerun from current `main`; never guess or rebind. |
| Status mismatch | `status-mismatch` | Reconcile does not silently enable/disable; review the manifest, then run the matching explicit lifecycle operation. |
| Denied | Actor/account/target/group/OIDC check fails | Verify allowlist and trust configuration; do not broaden permissions ad hoc. |
| Offline/dependency | AWS, GitHub, Cognito, Secrets Manager or pool inspection is unavailable | Stop. Do not retry a mutation blindly. Inspect current state first. |
| Partial error | One ordered AWS call succeeded before a later call failed | Follow section 13; never assume rollback occurred. |
| Unmanaged | A reserved Cognito identity is omitted from the manifest | Review separately. Omission intentionally causes no mutation. |

Statuses are always written as text; meaning never depends on colour.

## 13. Partial failure and 30-minute recovery

The workflow stops on the first ambiguous or failed AWS call and does not
automatically retry a mutation.

1. Preserve the sanitized run ID, operation, key and failure step.
2. Do not change the manifest, bind a guessed subject, or rerun immediately.
3. In AWS Console, inspect the exact Cognito username:
   - whether the user exists and is enabled;
   - its immutable `sub`;
   - whether it belongs only to `synthetic-test-users`.
4. Inspect only the secret metadata at the deterministic path:
   - whether it exists;
   - its last changed time and version count.
   Do not copy its value into recovery notes.
5. Compare AWS state with the manifest and the failed call:
   - secret exists, user absent: escalate for a separately reviewed recovery;
     ordinary reconciliation will not overwrite the existing secret;
   - user exists, manifest unbound: use the live `sub` only after username and
     group checks, then complete the binding PR;
   - user exists but password/group step failed: do not guess credential
     validity; use an explicitly reviewed rotate/reconcile recovery after the
     subject is bound;
   - secret rotation succeeded but password replacement failed: treat the
     credential as inconsistent and run an explicitly reviewed rotation
     recovery;
   - disable/enable status is ambiguous: inspect live state, align the
     reviewed desired status, then rerun only that lifecycle operation.
6. Record the recovery decision in SCRUM-190 without secrets.
7. Complete recovery and a clean verification run within 30 minutes, or leave
   the identity disabled and escalate.

Never use delete/recreate as an ordinary recovery path: it can invalidate the
immutable subject and application audit history.

## 14. Cost and teardown

Cognito user records in this development model are retained for audit and
stable subject binding. Secrets Manager secrets continue to incur storage
cost while the user is disabled or omitted.

SCRUM-190 intentionally provides no permanent user or secret deletion. If the
account owner needs complete teardown, create a separate Jira issue with:

- exact account alias, pool, synthetic keys and secret paths;
- retention and audit decision;
- impact of changing immutable subjects;
- reviewed Terraform/workflow permissions;
- post-delete verification and recovery limits.

Do not grant delete permissions temporarily through the Console or an inline
policy to bypass that review.

## 15. Verification targets

Pre-merge automated evidence must show:

- schema/manifest and workflow guard tests pass without AWS credentials;
- the deterministic 20-user fixture validates in at most 1 second and
  reconciles through the local AWS stub in 1 second on the implementation workstation
  (2026-07-31), comfortably below the five- and ten-minute targets; live AWS
  timing remains a post-merge check;
- 100 unchanged stub reconciliations produce zero creates, rotations,
  reactivations, duplicate mappings or group mutations;
- IAM tests prove exact required permissions and the absence of password read,
  user deletion, secret deletion and arbitrary-group authority;
- Java 17 mapping, reconciliation and role/site denial tests pass; the
  representative 20-request `/api/v1/me` integration assertion passed below
  one second p95, and an inactive database status denied the next request
  within the 60-second target on 2026-07-31;
- CI-only Terraform format, validate and test pass;
- ShellCheck, actionlint, secret scanning, dependency/static analysis and
  Terraform configuration scanning have no unreviewed high-severity result.

Post-merge evidence must cover first reconcile, subject binding, stable rerun,
all three persona logins and denials, rotation, disable and enable. Keep
SCRUM-190 **In Review** until those main-only checks pass.
