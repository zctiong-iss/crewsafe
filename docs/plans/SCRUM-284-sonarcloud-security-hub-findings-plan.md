# SCRUM-284 — SonarCloud Security Hub findings

## Scope

This change adds a CI-only, inactive-by-default importer after the existing Sonar
SAST job completes. It permits only open Blocker/High Vulnerability records from the approved
project, maps only allowlisted identifiers and timestamps into a redacted custom
finding, and is restricted to the approved Singapore account and region. It does not
change SCRUM-274 Inspector/ECR controls, create tickets, remediate findings, alter a
release decision, or aggregate across accounts or regions.

## Security and delivery controls

- The importer job runs after SAST completes on a `push` to `main`, including when the
  Sonar Quality Gate concludes unsuccessfully, with `contents: read` and job-scoped
  OIDC. A false reviewed configuration writes `NOT-ACTIVATED` and makes
  no Sonar or AWS call. Sonar requests are hard-allowlisted to `https://sonarcloud.io`;
  repository configuration cannot redirect the credential-bearing request.
- The Sonar credential is a dedicated repository secret. Raw Sonar messages, paths,
  snippets, tokens, personal data, and service responses are neither logged nor stored.
- The `securityhub-import` Terraform root owns a dedicated exact-main-subject role.
  The role has only the read/import actions needed to reconcile the custom product.
  Terraform is CI-only; no workstation Terraform, state, plan, profile, or apply is
  permitted.
- Central IAM policy management is applied first, then the importer component, using
  reviewed Terraform Plan and Terraform Apply workflows from `main`.

## Acceptance evidence mapping

| Requirement | Evidence |
| --- | --- |
| Selected finding appears as one redacted custom record | Hermetic importer tests plus a controlled reviewed-CI observation recorded in the runbook. |
| Excluded, malformed, out-of-scope, or rejected input fails closed | Hermetic fixtures and negative tests; only safe outcome labels are emitted. |
| Repeat import updates one stable record; controlled resolution archives it | Lifecycle mock tests, then separate controlled CI observation. |
| Existing security controls remain unchanged | SAST gate guard, Terraform catalog/source guards, and SCRUM-274 source guard. |
| Activation is safe and auditable | Inactive main result, reviewed CI infrastructure sequence, EventBridge review, and separate activation PR. |

## Verification

Run only the repository shell guard tests locally. Terraform formatting, validation,
and mocked contract tests run in Terraform Validation CI. The final evidence must link
the relevant CI run, approved account/region, redacted stable ID, timestamps, counts,
and text-labelled outcome. A result not observed within 60 minutes is `NOT-VALIDATED`.
