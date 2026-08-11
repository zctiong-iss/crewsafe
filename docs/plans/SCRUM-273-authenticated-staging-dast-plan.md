# SCRUM-273 — Authenticated staging DAST

## Decision

After each successful main-branch web or backend staging deployment, a local reusable
workflow runs OWASP ZAP's Automation Framework from a pinned image digest. It uses a
dedicated synthetic worker through Cognito Hosted UI browser authentication, assesses
only the reviewed staging web and backend origins, and treats Cognito as
authentication-only.

The active scanner may issue only GET/HEAD requests. A ZAP HTTP Sender guard rejects an
Active-Scanner request to any other host before it can be sent and rewrites any other
method to a bodyless HEAD request. This keeps the Automation Framework from failing the
whole plan while ensuring the target never receives the original mutating method or
payload. The guard does not interfere with the separate browser-login POST to Cognito.
Request bodies, cookies, and headers are not active-scan input vectors. Operational and
state-changing paths are excluded.

The workflow has `contents: read` only and receives only the DAST test password through
an explicit secret mapping. Raw traffic, session state, and reports exist only in the
ephemeral runner directory; the job summary contains release correlation, hostnames,
image/policy identifier, duration, and severity counts. Findings are advisory. Related
SCRUM-297 owns the separately reviewed promotion-blocking threshold.

## Constitution compliance

The design keeps authorization server-side and uses a minimum-scope synthetic user;
it does not change CrewSafe application behavior, deterministic safety policy,
Terraform, deployments, migrations, or AWS access. Static fixture tests precede the
workflow and scripts, including negative tests for malformed targets, secret handling,
caller ordering, method/host enforcement, and advisory versus unavailable outcomes.

An authorized maintainer must perform the first post-merge staging validation through
the normal CI deployment path and record only sanitized evidence. No workstation scan,
manual AWS operation, or secret value belongs in this procedure.
