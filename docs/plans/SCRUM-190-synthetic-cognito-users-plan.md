# SCRUM-190 — Synthetic Cognito user management plan

## Outcome

CrewSafe will manage a small set of fictional demo identities from a reviewed,
credential-free repository manifest. An allowlisted operator can reconcile or
manage one identity in one registered teammate AWS account through a
main-branch GitHub Actions workflow. Credentials never enter git, Terraform
state, workflow output, artifacts, or a developer AWS profile.

The initial set contains a worker, supervisor, and safety manager. Cognito
groups classify identities only; CrewSafe roles and site access continue to be
resolved server-side from the immutable Cognito `sub`.

## Approved design

- `.github/cognito/synthetic-users.yml` is the authoritative declaration of
  synthetic usernames, persona metadata, application role, site assignments,
  desired lifecycle status, account alias, classification group, and immutable
  Cognito subject.
- The manifest is closed-schema, contains no credentials, uses only the
  reserved `@synthetic.crewsafe.invalid` namespace, and supports up to 20 users
  per registered account.
- First creation is deliberately two-phase. Reconciliation creates the
  identity with invitation delivery suppressed and reports only its non-secret
  `sub`; a reviewed follow-up PR binds that value in the manifest.
- A generated permanent password is stored only at
  `crewsafe/<account-alias>/cognito/synthetic/<synthetic-key>` in that
  account's AWS Secrets Manager.
- GitHub Actions assumes the existing account-scoped Cognito administration
  role by OIDC. Mutations run only from the exact `main` revision, require an
  allowlisted actor and typed impact confirmation, and serialize per account.
- Reconciliation is idempotent. An unchanged bound user causes no credential,
  membership, identity, or application-status mutation.
- Lifecycle operations are explicit and separate: rotate, enable, and disable.
  Disable signs out current sessions; enable does not rotate credentials.
- Removing a declaration is report-only and non-destructive. Permanent
  Cognito-user or secret deletion is outside SCRUM-190 and requires separately
  reviewed teardown work.
- Human invitations remain AWS Console-only. Existing generic workflow
  operations cannot target manifest identities, the reserved namespace, or
  the `synthetic-test-users` group.
- Local application startup may read non-sensitive shared Cognito
  configuration and merge only bound synthetic declarations into the backend
  bootstrap mapping. It never reads AWS credentials or secrets.

## Security boundaries

- No local Terraform, AWS profile, or infrastructure mutation.
- No password read or output permission in GitHub Actions.
- IAM grants only the pool-scoped Cognito calls and account-scoped secret
  create/describe/update/random-password calls required by the lifecycle.
- The workflow does not receive `secretsmanager:GetSecretValue`, Cognito user
  deletion, secret deletion, or arbitrary-group authority.
- All repository, workflow, AWS, and runtime inputs are revalidated. Username,
  `sub`, account, Region, pool, manifest checksum, group, role, site and
  identity-kind conflicts fail closed.
- A Cognito group never grants a CrewSafe role or site. The backend maps the
  immutable subject to reviewed application data and enforces authorization
  at the role and site boundaries.

## Delivery sequence

1. Add failing manifest, reconciliation, lifecycle, IAM, runtime mapping and
   backend authorization tests.
2. Add the schema, initial unbound manifest, safe YAML resolver and
   credential-free CI validation.
3. Extend the existing Cognito administration workflow and IAM policy with
   deny-by-default target classification and synthetic reconciliation.
4. Merge bound declarations with the existing local application mapping and
   make status reconciliation explicit rather than omission-driven.
5. Publish the step-by-step runbook and link it from the shared-Cognito
   runbook.
6. Before merge, run shell guards, Java verification, CI-only Terraform
   validation/tests, linters, secret scanning and static analysis.
7. After merge to `main`, reconcile the three users, bind their sanitized
   subjects in a follow-up PR, rerun reconciliation to prove a no-op, and
   exercise login, denial, rotation, disable and enable journeys.

## Acceptance and operational evidence

- Credential-free validation completes within five minutes.
- Up to 20 declarations reconcile within ten minutes in at least 95% of
  normal runs.
- One hundred deterministic unchanged stub reconciliations produce no user
  creation, password generation or rotation, duplicate mapping,
  reactivation, or group mutation.
- A representative `/api/v1/me` request remains below one second p95, and
  reviewed role/site/status changes are visible to a new session within
  60 seconds.
- Workflow summaries contain only actor, account alias, operation, synthetic
  key, immutable `sub`, result, run ID, revision/checksum context and
  timestamps—never credentials or secret values.
- The runbook covers loading, empty, success, validation, offline/dependency,
  stale, denied and partial-error states, plus recovery within 30 minutes.

## Dependencies and boundaries

SCRUM-190 extends the shared remote Cognito model introduced by SCRUM-154 and
the CI-only managed Terraform backend from SCRUM-155. It follows
[ADR 0006](../adr/0006-shared-remote-cognito-for-development.md). The live
post-merge workflow and immutable-sub binding cannot be completed safely on a
feature branch; SCRUM-190 remains In Review until that evidence is attached.
