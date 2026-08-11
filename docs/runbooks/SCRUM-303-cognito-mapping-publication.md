# SCRUM-303 — Cognito mapping publication

## Purpose and preconditions

This runbook publishes the reviewed, non-secret application-user mapping for one registered staging account and restarts the backend on its verified immutable image. It is an authorization-sensitive operation: use it only when the reviewed shared Cognito configuration and synthetic-user manifest are both ready, and only an account-scoped allowlisted operator may dispatch it.

Do not run Terraform, AWS CLI, or an AWS profile locally. Do not manually edit the database or parameter. There is no local or manual bypass.

Before dispatching, confirm that CI has validated and provisioned the dedicated mapping-publication role, the selected account alias is registered in both reviewed sources, and every selected synthetic identity has a bound immutable Cognito subject. The workflow does not create Cognito users or grant access to an unmapped identity.

## Controlled dispatch

1. In GitHub Actions, select **Cognito Mapping Publication** on `main` only (`refs/heads/main`); it is a `workflow_dispatch` operation and must never be run from a branch.
2. Enter the registered account alias and the exact confirmation `publish-mapping <alias>`.
3. Wait for preflight validation. Do not start another publication for the same account: the workflow serializes each account and does not cancel an active run.
4. After the immutable backend redeploy reports completion, test in new browser sessions: a mapped active identity must reach only its assigned role/site scope, while an unmapped or inactive identity remains denied. Cognito group membership alone never grants CrewSafe access.

## Operational states and evidence

| State | Meaning and operator action |
| --- | --- |
| Validation | No AWS credentials have been acquired. Correct reviewed source, actor, alias, confirmation, or branch state through normal review. |
| Empty | A selected account has no approved mapping. Stop and establish reviewed configuration; never publish a partial or guessed mapping. |
| Success | The fixed parameter write and immutable backend redeploy completed. Record only sanitized evidence. |
| Stale | The re-derived checksum differs from preflight. Treat the reviewed sources as changed; start a new controlled run after review. |
| Denied | An unmapped, inactive, wrong-role, or wrong-site identity is correctly refused by the backend. Do not use a Cognito group as a workaround. |
| Offline | GitHub Actions or the AWS dependency is unavailable. Preserve the run link and wait or escalate; do not switch to a workstation procedure. |
| Error | A failure after the parameter write leaves live state uncertain. Follow controlled recovery below. |

Sanitized evidence may include account alias, actor, run ID/link, source revision/checksum, fixed-scope assertion, timestamps, and deployment result. Never record mapping JSON, user names, email addresses, account IDs, tokens, credentials, parameter values, or headers.

## Recovery after an uncertain write or deployment

If validation fails, nothing reached AWS: correct the reviewed input and retry through the workflow. If the workflow reports an error after its write step, treat the mapping as possibly changed. Do not retry blindly and do not attempt rollback. Preserve sanitized evidence, use the approved operational inspection path to determine the current deployment state, and perform a controlled retry or escalate to the platform owner within 30 minutes. The next attempt must start from `main` with a fresh preflight checksum.

## Post-deploy verification

Use a new private browser session after a successful rollout. Confirm the expected active mapped account can use the allowed role/site journey and that separate unmapped and inactive identities receive a denied response. Attach only sanitized results to SCRUM-303 and the pull request.
