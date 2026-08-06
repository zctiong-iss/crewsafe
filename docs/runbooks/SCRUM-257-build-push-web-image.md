# SCRUM-257 — Build and Push Web Image Runbook

**Workflow:** `.github/workflows/web-ci.yml`  
**Repository:** `zctiong/crewsafe`  
**Region:** `ap-southeast-1`  
**Upstream:** SCRUM-253 web ECR registry

## 1. Required repository variables

Configure these GitHub repository variables before enabling publication:

| Variable | Required value |
|---|---|
| `CREWSAFE_WEB_ECR_REPOSITORY_URL` | The regional twelve-digit SCRUM-253 ECR URL ending in `/crewsafe/web`. |
| `CREWSAFE_WEB_ECR_PUSH_ROLE_ARN` | The twelve-digit AWS ARN for the dedicated SCRUM-253 role `crewsafe-shared-dev-ecr-web-push`. |

The workflow validates both values in the publication job. Do not add AWS access keys,
secret keys, ECR backend variables, or deployment variables.

## 2. Trigger matrix

| Run | Validation | Publication |
|---|---:|---:|
| Pull request targeting `main` | Yes | Never |
| Push to `main` | Yes | After successful validation |
| Manual `main`, `publish=false` | Yes | Never |
| Manual `main`, `publish=true` | Yes | After successful validation |
| Manual non-main ref | Yes | Never |

The workflow cancels superseded runs for the same ref. Cancelled, stale, denied, and
failed runs are not release evidence.

## 3. Validation and publication sequence

`build-test` checks out the pull-request head SHA or event SHA and runs from `web/`:

```text
npm ci → npm run lint → npm run typecheck → npm test → npm run build
```

`publish-image` requires that job, the `main` ref, and the push/manual predicate. It then
validates the repository/role contract, builds `web/Dockerfile`, runs blocking Trivy for
HIGH and CRITICAL findings, assumes the dedicated role using GitHub OIDC, logs in to the
exact web ECR repository, and pushes:

```text
<CREWSAFE_WEB_ECR_REPOSITORY_URL>:<GITHUB_SHA>
```

The image URI, source tag, and content digest are job outputs and text-labelled summary
evidence. A failed build, scan, role assumption, login, push, or digest extraction stops
the job and cannot claim publication success.

## 4. Local validation

These checks do not use AWS credentials, Terraform, ECR mutation, deployment, or runtime
pull verification:

```bash
.github/scripts/tests/test-frontend-ci-guards.sh
.github/scripts/tests/test-web-image-workflow.sh
cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build
cd ..
docker build --file web/Dockerfile --tag crewsafe-web:local web
trivy image --scanners vuln --severity HIGH,CRITICAL --exit-code 1 crewsafe-web:local
```

Run `actionlint .github/workflows/web-ci.yml` and `shellcheck` against both guard scripts
when those tools are available.

## 5. Failure and recovery

| State | Safe response |
|---|---|
| Missing/invalid variable | Correct the repository variable and rerun the same reviewed revision. |
| Web check, Docker build, or Trivy failure | Fix the source/container issue; do not bypass or soften the gate. |
| OIDC denied or ECR login/push failure | Verify SCRUM-253 role trust, exact repository output, and AWS availability through approved CI; rerun. |
| Cancelled/superseded/stale run | Treat as non-authoritative and rerun the reviewed revision. |
| Runner/provider outage | Leave the failure visible, then retry after service recovery. |

Never broaden the role, change the repository, add a mutable tag, use long-lived
credentials, or manually publish an image as recovery.

## 6. Evidence ledger

| Evidence | Status |
|---|---|
| Frontend guard script | 2026-08-06 local: 59 checks, 0 failures. |
| Web image guard script and negative fixtures | 2026-08-06 local: 66 checks, 0 failures. |
| Web npm validation sequence | 2026-08-06 local: `npm ci`, lint, type-check, 51 tests, and production build passed; existing lint warnings only. `npm audit` reported 2 moderate advisories. |
| Local Docker build and Trivy scan | 2026-08-06 local: image build passed, `/callback` SPA fallback smoke test passed, and Trivy found 0 HIGH/CRITICAL vulnerabilities. |
| Actionlint and ShellCheck | ShellCheck passed for both guard scripts; actionlint 1.7.7 passed from a temporary downloaded binary. Ruby YAML parsing passed for both workflow jobs. |
| Secret/SAST/dependency checks | SAST configuration: 34 checks, 0 failures. Secret gate structural checks: 3 passed; gitleaks unavailable locally and remains CI-required. |
| 20 representative workflow runs and p95/success rate | Pending after workflow has run 20 times. |
| Published URI/tag/digest evidence | Pending first eligible `main` publication; do not fabricate. |
