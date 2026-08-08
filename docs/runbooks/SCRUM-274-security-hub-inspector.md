# SCRUM-274 — Security Hub / Inspector ECR finding triage

## Scope and safety

This runbook covers the account-local CrewSafe ECR Security Hub Insight in
ap-southeast-1. It is a manual, read-only triage procedure for a supervisor
or security reviewer. The deterministic GitHub security gates remain unchanged;
an image is not considered safe because a finding is missing, delayed, or
unavailable.

Never run Terraform, enable or disable AWS services, change ECR scanning, or
make other AWS mutations from a workstation. Terraform changes go through the
reviewed CI plan/apply workflow and the approved account dispatch only. Do not
paste credentials, tokens, PII, or a raw finding payload into Jira, chat, shell
history, or this repository. Redact account identifiers and unrelated resource
details from evidence.

The implementation intentionally does not import ASFF, persist findings,
use automated Jira creation, invoke automatic remediation, use Security Lake,
or use Grafana. Any Jira issue is created manually by a reviewer after the
evidence has been checked.

## Expected control state

| Control | Expected state | Review evidence |
| --- | --- | --- |
| AWS account and region | Approved account, ap-southeast-1 | CI dispatch record and console account/region selector |
| Security Hub | Enabled; default standards are not managed by this component | Security Hub summary page |
| Inspector | ECR resource type enabled | Inspector coverage/settings page |
| ECR scanning | Enhanced, CONTINUOUS_SCAN, repositories crewsafe/backend and crewsafe/web only | ECR scanning configuration |
| Security Hub Insight | CrewSafe ECR Active Critical and High, grouped by resource identity | Insight name and ARN output |
| Finding scope | Inspector product, AwsEcrContainerImage, ACTIVE, NEW or NOTIFIED, CRITICAL or HIGH | Insight filters |

The Insight is a triage view, not a release approval. Repository and image
digest must be read from the finding's resource details. Do not infer the
digest from a tag, and do not use colour alone to communicate state.

## CI validation and apply evidence

The pull request must pass Terraform Validation, including formatting,
validation, mocked tests, shell/source guards, and the applicable security
scans. After merge to main, use the approved Terraform State Plan workflow for
ecr-shared-dev and review the account, region, exact repository filters, four
security resources, and expected resource delta before approval.

Use Terraform State Apply only with the successful plan run ID and the required
typed confirmation. Record the following values in the evidence ledger:
Record the plan run ID and apply run ID only; do not record a saved plan or
raw service response.

| Field | Value |
| --- | --- |
| Terraform Validation run | PENDING |
| Terraform State Plan run ID / URL | PENDING |
| Terraform State Apply run ID / URL | PENDING |
| Approved account / region | PENDING |
| Resource delta | PENDING |
| Security Hub Insight ARN | PENDING |

An unexpected account, region, repository, role, workflow, or destroy action
blocks apply. No local Terraform command, local AWS profile, state file, or
saved plan is an accepted substitute for CI evidence.

## State matrix

Use the text-labelled state in the table and in Jira. A scanner that is
skipped, failed, delayed, or not validated is not clean.
Such a result must not be reported as clean.

| Text state | Meaning | Reviewer action |
| --- | --- | --- |
| LOADING | Console or read-only query is still retrieving evidence | Wait; do not infer a clean result |
| EMPTY | No finding is currently returned for the selected filters | Recheck repository and digest; absence alone is not clean |
| SUCCESS | Required finding fields are visible and match the CI digest | Continue the human review |
| VALIDATION | Repository, digest, state, and timestamps are being compared | Keep approval pending until the comparison completes |
| OFFLINE | The reviewer cannot reach the evidence path | Mark NOT-VALIDATED and escalate; do not use local assumptions |
| STALE | Evidence is older than the image publication or retry window | Retry the approved read-only check and retain the old timestamp |
| DENIED | The reviewer or CI role lacks required access | Stop; escalate the authorization issue |
| ERROR | The service or query returned an error | Record the error step and mark UNKNOWN or NOT-VALIDATED |
| PENDING | CI image publication or Inspector propagation is still within the 60 minutes target | Record observation time and retry after the target |
| UNKNOWN | The repository, digest, or finding cannot be matched confidently | Stop approval; investigate identity and permissions |
| FAILED | A GitHub security gate or required scan failed | Treat the image as not clean; follow the existing gate workflow |
| NOT-VALIDATED | Required evidence is absent, stale, or the service was unavailable | Treat the image as not clean; do not approve on absence |
| ACTIVE | Finding remains open in Security Hub | Triage the repository and image digest |
| NEW | Finding has not been acknowledged in the Security Hub workflow | Assign a human reviewer and record the evidence |
| NOTIFIED | Finding has been acknowledged for follow-up but remains actionable | Keep the image blocked until closure evidence exists |
| CLOSED | A human reviewer has confirmed the issue is resolved or accepted under the project process | Record the closure reason and approving reviewer |

## Manual triage

1. Confirm the account and region in the console. Confirm the release commit,
   repository, image tag, and image digest from the CI job. The digest is the
   primary identity.
2. Open the saved Insight named CrewSafe ECR Active Critical and High.
   Confirm that its filters still show Inspector, ECR container images, active
   records, NEW/NOTIFIED workflow, and Critical/High severity.
3. Open the matching finding and record only the minimum evidence:
   repository, image digest, finding title or identifier, severity, first
   observed time, current workflow state, and the reviewer. Do not export or
   persist the raw finding payload.
4. Compare the finding digest with the CI digest. If they differ, mark the
   release UNKNOWN and stop. A repository name without a matching digest is
   insufficient evidence.
5. Check the existing GitHub security gates and their timestamps. A skipped or
   failed scanner is not clean, even when the Security Hub Insight is empty.
6. If propagation is expected, mark the release PENDING, record the
   observation time, and retry once the 60 minutes target has elapsed. If the
   service is unavailable or the result remains absent, mark it
   NOT-VALIDATED, not clean.
7. For a confirmed finding, create or update a Jira issue manually. Include the
   repository, image digest, finding identifier, severity, evidence timestamp,
   reviewer, and proposed owner. Do not include secrets, tokens, PII, or raw
   payloads.
8. The reviewer decides whether the image is replaced, the build is held, or an
   approved exception process is used. Replacement means publishing a new
   immutable digest; never overwrite the affected tag.
9. After the replacement or other approved remediation is verified, retry the
   Insight and the GitHub security gates. Record the new digest separately.
   Close the Jira issue only after a human reviewer confirms closure evidence.

### Optional read-only field check

If console access is unavailable, a reviewer may use an approved read-only
role and a narrow query that displays selected fields only. Do not redirect the
output, enable debug logging, or save the response:

    aws securityhub get-findings +      --region ap-southeast-1 +      --filters '...' +      --query 'Findings[].{Id:Id,Severity:Severity.Label,State:RecordState,Workflow:Workflow.Status,Resources:Resources[].Id,Updated:UpdatedAt}' +      --output table

The command is illustrative: the reviewer must use the saved Insight filters
and approved read-only role. A permission error or empty response is UNKNOWN
or NOT-VALIDATED depending on whether identity or service availability is the
cause; neither state is clean.

## Evidence ledger

Record one row per attempted review. Use placeholders until evidence is
available; never invent a successful result.

| Field | Value |
| --- | --- |
| Account alias / region | PENDING |
| Repository | PENDING |
| Image digest | PENDING |
| CI publication timestamp | PENDING |
| Security Hub observation timestamp | PENDING |
| Finding identifier / title | PENDING |
| Severity and workflow state | PENDING |
| Text-labelled release state | NOT-VALIDATED |
| GitHub gate result | PENDING |
| Jira key (manual, if needed) | PENDING |
| Replacement digest (if applicable) | PENDING |
| Reviewer and closure evidence | PENDING |

## Operational acceptance and escalation

For SCRUM-274 acceptance, a synthetic image test must record publication time,
the repository, digest, first observed Inspector/Security Hub finding time, and
the elapsed propagation time. The target is 60 minutes. If the result is not
observed within that target, record NOT-VALIDATED, attach only redacted
metadata, and escalate to the platform owner; do not claim the scan is clean.

If the result remains unresolved for one business day, escalate to the
security/platform owner and the issue owner. The escalation must include the
redacted evidence ledger, the CI run link, the repository and digest, and the
exact text-labelled state. It must not include credentials or a raw finding
payload.

## Rollback

Rollback is a reviewed code revert followed by a new CI plan/apply in the
approved account. Do not run Terraform destroy or disable Security Hub,
Inspector, or ECR scanning from a workstation, and do not use destruction as a
finding-remediation shortcut. Until the reviewed rollback completes, hold the
affected image and keep the state NOT-VALIDATED or UNKNOWN as appropriate.
