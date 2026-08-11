# SCRUM-299 — Cognito staging web callback and logout URLs plan

## Purpose

Allow the deployed staging CrewSafe web SPA to complete Cognito Hosted UI sign-in and sign-out
without widening the `crewsafe-web` redirect surface.

The web client has exactly these callback URLs:

```text
http://localhost:5173/callback
https://d3b75ru76gta2n.cloudfront.net/callback
```

It has exactly these logout URLs:

```text
http://localhost:5173/
https://d3b75ru76gta2n.cloudfront.net/
```

The localhost entries remain because the documented local Vite development workflow is fixed to
port 5173. Callback and logout URLs are separate Cognito allowlists; neither list authorizes a
value in the other.

## Scope and safeguards

- Extend only `infra/terraform/cognito`'s existing `crewsafe-web` URI-variable contract.
- Preserve the existing `main.tf` wiring, public-client OAuth configuration, user pool, mobile
  client, and CLI client.
- Use exact URI validation, Terraform tests, and post-apply AWS-state verification. Wildcards,
  arbitrary domains, alternate localhost ports, query-derived values, and mobile custom schemes
  are rejected for the web client.
- Do not call this issue a CORS fix: Cognito validates these redirects before the browser reaches
  the backend.
- Never run Terraform locally and never use the AWS console to modify Cognito. Terraform plan
  and apply use the repository CI workflow only.
- Do not commit or log OAuth codes, tokens, credentials, Terraform state, saved plans, or full
  Cognito client responses.

## Delivery sequence

1. Add Terraform contract assertions and shell-verifier tests before changing their production
   configuration. The tests must demonstrate that a missing or extra URI is rejected.
2. Change the two web URI variables to their bounded two-item lists.
3. Extend the existing post-apply Cognito verifier to require exact deployed callback and logout
   URL sets, while retaining its existing public-client security checks.
4. Require PR Terraform validation CI, including formatting, `terraform validate`, and
   `terraform test -no-color`; these commands are not run on a workstation.
5. Review a `cognito-shared-dev` CI plan. It must show only the intended `crewsafe-web` URI
   changes, with no mobile, CLI, pool, IAM, CORS, or unrelated resource delta.
6. After merge to `main`, apply the exact reviewed plan through the main-only Terraform apply
   workflow using its required typed confirmation. The automated post-apply verifier must pass.
7. Manually verify deployed Hosted UI sign-in returns to `/callback` and sign-out returns to the
   deployed origin root. Record redacted outcome and CI run references in the runbook.

## Constitution compliance

The change is a narrow, maintainable extension of existing static Terraform validation. It remains
deny-by-default, includes negative tests, creates no user-facing application endpoint or database
change, and preserves CI-only remote-state infrastructure controls. No architectural departure or
ADR is required.
