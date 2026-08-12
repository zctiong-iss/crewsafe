# SCRUM-299 — Deploy Cognito staging web callback and logout URLs

## Purpose and boundary

This runbook deploys the reviewed SCRUM-299 `crewsafe-web` Cognito URI allowlist change. It is
limited to the two exact callback and two exact logout URLs recorded in the
[SCRUM-299 plan](../plans/SCRUM-299-cognito-staging-redirect-urls-plan.md).

> Never run Terraform locally. Never edit the Cognito client in the AWS console. Never add a
> wildcard, alternate port, arbitrary domain, native-mobile URI, saved plan, or token to resolve a
> redirect failure.

## Preconditions

- The pull request is reviewed, linked to SCRUM-299, and merged to `main`.
- The Terraform validation workflow is successful, including formatting, `terraform validate`,
  `terraform test -no-color`, guard tests, and applicable security scanning.
- The reviewer confirms the expected resource delta is limited to the `crewsafe-web` callback and
  logout allowlists. Any change to a user pool, mobile or CLI app client, IAM, CORS parameter, or
  unrelated resource is a stop condition.
- All evidence is redacted: do not place OAuth codes, tokens, credentials, client JSON, Terraform
  state, or saved plan files in Jira, Git, CI logs, or this document.

## Reviewed CI plan

1. Manually dispatch **Terraform State Plan** from the reviewed source using the registered
   staging account alias, `cognito-shared-dev`, and operation `apply`.
2. Inspect the CI plan summary. Confirm only the two required deployed URLs are added to their
   respective `crewsafe-web` lists and the retained local `localhost:5173` values remain.
3. Record the plan run ID and attempt in the change review, not a plan artifact or plan content.
4. If the plan is failed, pending, unknown, stale, or has an unexpected delta, do not apply it.
   Correct the reviewed source and generate a new plan.

## CI apply

1. From `main`, manually dispatch **Terraform State Apply** for the same staging alias and
   `cognito-shared-dev` component.
2. Supply the successful plan run ID and attempt, select operation `apply`, and provide the
   workflow's required typed `APPLY <alias> <component>` confirmation.
3. Confirm the workflow consumes the exact reviewed plan and its post-apply Cognito verifier
   succeeds. The verifier checks the deployed URI lists without exposing the full client response.
4. Record the apply run ID and redacted pass/fail outcome. A failed or not-validated apply is not
   deployment evidence and must not be reported as successful.

## Browser acceptance checks

1. Open `https://d3b75ru76gta2n.cloudfront.net` and initiate Hosted UI sign-in with an approved
   test account. Confirm the browser reaches
   `https://d3b75ru76gta2n.cloudfront.net/callback` and does not show `redirect_mismatch`.
2. Invoke the SPA's sign-out action. Confirm Cognito ends the hosted session and the browser
   reaches `https://d3b75ru76gta2n.cloudfront.net/`.
3. Record a redacted timestamp, outcome, and CI plan/apply run references. Do not record account
   details, authorization codes, tokens, browser URLs containing sensitive query values, or client
   responses.

## Failure, retry, and rollback

- **Validation or plan failure**: Treat as denied. Correct source only through a new reviewed
  change; do not repair it in the console.
- **Unexpected plan delta**: Stop and reject the plan. Re-run CI only after the source and review
  explain every change.
- **Apply failure or verifier failure**: Treat as not deployed. Preserve redacted CI evidence and
  create a new reviewed corrective change; do not reuse the plan artifact.
- **Browser redirect failure**: Verify the deployed SPA's configured redirect values and the CI
  evidence. Do not use CORS changes as a workaround and do not widen the Cognito list.
- **Rollback**: Submit a reviewed source revert to the previous exact URI contract, then use a new
  CI-only plan and main-only apply. A console edit and local Terraform are prohibited.
