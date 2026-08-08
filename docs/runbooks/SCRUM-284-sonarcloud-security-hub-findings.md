# SCRUM-284 — SonarCloud Security Hub importer runbook

## Safety boundary

Never run Terraform locally. Never use a local AWS profile, saved plan, state file,
or direct cloud command to test this importer. The only accepted infrastructure path is
Terraform Validation, then reviewed Terraform Plan and Terraform Apply workflows on
`main`. The importer is not an automatic remediation, ticket creation, or release gate.

All evidence is redacted evidence: workflow URL/ID, approved account alias and region,
validated stable identifier, timestamp, count, and text-labelled outcome. Do not record
credentials, tokens, source paths, source code, snippets, raw Sonar response, raw AWS
response, or personal data.

The importer accepts only the exact `https://sonarcloud.io` origin. A configuration that
attempts any other origin is denied before a request is made.

## Staged activation

1. Merge the plumbing change with `.github/securityhub-import.json` set to false.
   Confirm a `main` Security Scan reports `NOT-ACTIVATED`; it must make no cloud call.
2. Run and review the `iam-policy-management-shared-dev` Terraform Plan. Apply it only
   after approval, with its successful plan run ID and typed confirmation.
3. Run and review the `securityhub-import-shared-dev` Terraform Plan. Apply it only
   after step 2 is successful, again using the exact approved plan evidence.
4. An authorized account reviewer configures the dedicated secret and repository
   variables without disclosing values. The reviewer records an EventBridge rule/target
   review proving this custom product has no automatic remediation target. Unknown or
   remediating automation blocks activation.
5. In a separate reviewed change, set the activation flag true and provide the controlled
   issue key. Never combine this with the plumbing change.

## Controlled verification

After SAST succeeds on a reviewed `main` run, observe the selected custom finding in
`ap-southeast-1`. Record only the project/rule identifiers, mapped severity, commit
reference, timestamps, stable ID, one abstract resource, run link, and outcome.

Repeat once with permitted metadata change: exactly one stable record must show the later
timestamp. Resolve only the configured controlled issue and observe `ARCHIVED` for the
same record. If a required observation is absent after 60 minutes, record
`NOT-VALIDATED`; do not describe it as clean, closed, or synchronized.

## Text states and degraded outcomes

| State | Meaning and reviewer action |
| --- | --- |
| `NOT-ACTIVATED` | Expected inactive plumbing state; no import occurred. |
| `IMPORTED`, `UPDATED`, `ARCHIVED` | A controlled CI result; still capture redacted evidence. |
| `REJECTED` | Input or lifecycle precondition was safely excluded; inspect the safe reason only. |
| `FAILED` or `FAILED_PARTIAL` | Dependency, validation, or import failure; no whole-run success claim. Diagnose, correct, and rerun reviewed CI. |
| `NOT-VALIDATED` | Observation unavailable, stale, denied, or beyond 60 minutes; escalate without inferring a clean state. |

For Sonar unavailability/authentication failure, malformed input, account/region denial,
ambiguous identity, or Security Hub rejection, retain the safe state and CI link only.
Do not retry with local credentials or turn on debug logs containing sensitive content.

## Rollback

Roll back by a reviewed code revert followed by CI validation. A reviewed code revert
stops future imports; it does not delete historical evidence or change SCRUM-274
controls. Any IAM removal is a separately reviewed CI Terraform change, never a local
destructive action.

## Evidence ledger

| Field | Value |
| --- | --- |
| Security Scan run URL/ID | PENDING |
| Terraform Validation / Plan / Apply run IDs | PENDING |
| Approved account alias / region | PENDING |
| Stable identifier | PENDING |
| Observation timestamp | PENDING |
| Outcome | NOT-VALIDATED |
| EventBridge reviewer / date | PENDING |
| Reviewer / rollback evidence | PENDING |
