# Implementation Plan: Security Hub Inspector ECR Findings

**Jira**: SCRUM-274 (subtask of SCRUM-145) · **Branch**:
feat/scrum-274-security-hub-inspector-ecr-findings · **Date**: 2026-08-07

## Scope

Extend the existing ecr-shared-dev Terraform component in the approved
ap-southeast-1 account with AWS-native image finding coverage:

- enable Security Hub without enabling default standards through this component;
- enable Amazon Inspector for ECR only;
- configure enhanced continuous ECR scanning for crewsafe/backend and crewsafe/web;
- create one stable Security Hub Insight for active Critical/High Inspector ECR
  container-image findings, grouped by resource identity.

The change does not add an ASFF importer, CI finding store, Jira integration,
automatic remediation, Security Lake, Grafana, cross-account aggregation, or
cross-Region aggregation. GitHub security gates remain unchanged.

## Design and compatibility

The existing component root, catalog key, remote state key, provider lockfile,
CI plan/apply workflow, and allow_destroy: false boundary remain unchanged.
The expected Terraform resource delta is 4 to add, 0 to change, and 0 to
destroy:

| Resource | Contract |
| --- | --- |
| aws_securityhub_account.mvp | Approved caller account; default standards disabled |
| aws_inspector2_enabler.ecr | Expected account; resource_types exactly ECR |
| aws_ecr_registry_scanning_configuration.enhanced | ENHANCED; CONTINUOUS_SCAN; exact backend/web filters |
| aws_securityhub_insight.ecr_active_critical_high | Inspector, ECR image, ACTIVE, NEW/NOTIFIED, CRITICAL/HIGH; ResourceId grouping |

The new Insight ARN is exposed as securityhub_ecr_insight_arn. Repository and
immutable image digest remain finding-detail evidence; no finding payload is
copied into Terraform state beyond provider-managed resource metadata.

## Security and operational controls

All account-level resources have the existing caller-account precondition and
are restricted by the existing ap-southeast-1 variable validation. Plan
permissions are read-only. Apply permissions are isolated into named policy
statements for Security Hub, Inspector ECR enablement, and registry scanning;
provider-required wildcard resources are explicit and reviewable.

Validation is test-first: mocked Terraform tests cover malformed inputs,
mismatched callers, ECR-only scope, exact repository filters, Insight filters,
grouping, and output identity. Shell guards cover IAM actions, workflow wiring,
forbidden integrations, catalog/state preservation, runbook evidence, and
redaction rules.

Terraform and AWS mutations are CI-only. The runbook at
docs/runbooks/SCRUM-274-security-hub-inspector.md provides manual triage,
repository/digest matching, retry, replacement, Jira linking, closure, and
degraded states. PENDING, UNKNOWN, FAILED, and NOT-VALIDATED are never reported
as clean. Synthetic propagation evidence targets 60 minutes and is recorded
with publish/observation timestamps.

## Constitution compliance

The design stays within the approved AWS/Terraform/GitHub Actions stack and
existing remote-state boundary. It adds no secrets, local state, saved plans,
raw finding payloads, probabilistic safety decision, or automatic remediation.
It preserves least privilege, explicit account/Region scoping, CI review gates,
test-first evidence, text-labelled operational states, and measurable
propagation/recovery evidence.

## Required review evidence

Before merge, Terraform Validation must pass formatting, validation, and
mocked tests; shellcheck and actionlint must pass; applicable secret, static,
dependency, and Trivy scans must remain clean. An approved CI plan/apply must
record its run identifiers, account, Region, resource delta, and Insight ARN.
A synthetic image exercise must record repository, digest, publish time,
Security Hub observation time, finding state, and any degraded outcome.
