# Runbook — `compute-shared-dev` web additions (SCRUM-298)

Web static hosting runtime and staging origin. Extends the existing `compute-shared-dev`
component (SCRUM-176) with a private S3 bucket and a second CloudFront distribution — no
container, no ECS service, no ALB involvement.

**Component**: `compute-shared-dev` (extended, not new) · **Root**: `infra/terraform/compute` ·
**State key**: `crewsafe/compute/shared-dev.tfstate` (unchanged) · **Destroy-approved**: no

**Plan**: [SCRUM-298-web-compute-runtime-plan.md](../plans/SCRUM-298-web-compute-runtime-plan.md)

**Status (2026-08-10)**: Terraform, tests, guards, and the sync workflow are written and pass
offline (22/22 `terraform test` in `compute-shared-dev`, 3/3 in `iam-policy-management`, 44/44
source-guard checks, 38/38 workflow-guard checks, 0 HIGH/CRITICAL Trivy findings). **Nothing has
been applied to AWS.** §4's two-step apply (`iam-policy-management-shared-dev` first, then
`compute-shared-dev`) and §7 (initial sync) are all still outstanding and require real AWS/GitHub
access. §2 was originally written describing a hand-attachment mechanism that turned out to be
wrong — corrected in place; see its own note.
See the plan's Implementation Notes for what was found and fixed along the way.

---

## 1. What this is, and what it deliberately is not

`web/` is a plain client-rendered Vite SPA with no server-side runtime need — confirmed by reading
`web/package.json` and `web/vite.config.ts` during `/speckit-specify`. It needs somewhere to serve
static files from, not a container runtime. The shape decided (twice — see spec.md Clarifications)
is:

```text
        Client (browser)
            │  443/TCP, TLS, provider-issued hostname
            ▼
   CloudFront distribution "web" (NEW)
     default cert, own hostname, distinct from the backend's
     custom_error_response: 403/404 → 200 /index.html (SPA fallback)
            │  Origin Access Control — signed requests, private path
            ▼
   S3 bucket "web" (NEW)
     private — all public access blocked, BucketOwnerEnforced
     versioned, SSE-encrypted, noncurrent versions expire after 30 days
     bucket policy: read-only, scoped to this exact distribution ARN
```

**Nothing here touches `aws_lb.public`, `aws_ecs_cluster.main`, `aws_ecs_service.backend`, or
`aws_cloudfront_distribution.main`** — the backend's existing, already-applied resources. This
was originally scoped to extend the shared ALB (Shape B); that decision was revised once `web/`'s
actual requirements were confirmed. See spec.md's Clarifications for the full reasoning.

**There is no health check, no target group, no circuit breaker, and that is deliberate, not an
oversight.** A static S3/CloudFront origin has no target-group-style unhealthy state. See §5.

---

## 2. IAM permissions — Terraform-managed, not hand-attached

**Correction (2026-08-10): this section originally described hand-attaching a second
customer-managed policy under `infra/terraform/compute/iam/`, following SCRUM-176's manual
console-attachment runbook pattern. That mechanism is superseded.** SCRUM-265
(`infra/terraform/iam-policy-management/`) is the authoritative source for every component's
plan/apply permissions now — this was missed during `/speckit-research` and caught only once real
files were opened during implementation. The old per-component JSON files under
`infra/terraform/compute/iam/` are, per the SCRUM-265 runbook, "compatibility inputs for their
existing source guards" only — not something to hand-edit or hand-attach for a new grant. They
were reverted to their original (pre-SCRUM-298) content.

**What this feature actually did**: added a new logical component, `compute-web`, to
`infra/terraform/iam-policy-management/main.tf`'s `local.components` list (16 bindings now, was
14), with its own policy templates:

| File | Grants |
| --- | --- |
| [`policies/compute-web/plan.json.tftpl`](../../infra/terraform/iam-policy-management/policies/compute-web/plan.json.tftpl) | Read-only: the web bucket, the OAC, the sync role |
| [`policies/compute-web/apply.json.tftpl`](../../infra/terraform/iam-policy-management/policies/compute-web/apply.json.tftpl) | Manage: the web bucket, the web distribution + OAC, the sync role only |

Both attach automatically to the existing `CrewSafeGitHubTerraformPlanRole` /
`CrewSafeGitHubTerraformApplyRole` the next time `iam-policy-management-shared-dev` is applied —
**no hand-attachment step exists for this or any other component under SCRUM-265.**

**Why a separate `compute-web` component, not folded into `compute`'s existing templates**: adding
this feature's grants to `policies/compute/apply.json.tftpl` in place would have pushed it to
~6,200 non-whitespace characters — just over the 6,144 customer-managed-policy limit. A sibling
component (mirroring `securityhub-import`'s precedent of a feature-scoped, non-1:1-with-a-root
component name) sidesteps the budget question entirely: each new template is under 2,000
characters, independently far from either limit, and the already-applied `compute` templates stay
untouched (no re-review risk).

**Apply ordering, corrected**: `iam-policy-management-shared-dev` must be planned and applied
**before** `compute-shared-dev`'s own apply for this feature — the apply role needs the
`compute-web` grants to exist before it can create the bucket, distribution, OAC, or sync role.
See §5.

Merging this component's pull request changes nothing in AWS until `iam-policy-management`'s own
plan/apply runs — the same standing warning every component's runbook states, just via a different
mechanism than SCRUM-176 documented.

---

## 3. Offline checks — before every push

```bash
cd infra/terraform/compute
terraform fmt -check -recursive .
terraform init -backend=false
terraform validate
terraform test                       # 21 runs (15 backend + 6 web), mocked provider, no AWS account

cd -
.github/scripts/terraform/tests/test-compute-source-guard.sh   # 44 checks
.github/scripts/terraform/tests/test-component-catalog.sh
.github/scripts/terraform/tests/test-ci-guards.sh
.github/scripts/terraform/tests/test-workflow-guards.sh
trivy config --severity CRITICAL,HIGH infra/terraform/compute  # 0 findings
```

---

## 4. Dispatch a plan, then review it by eye

**Ordering (corrected, §2): `iam-policy-management-shared-dev` first.**

```bash
# 1. The compute-web IAM grants — must land before compute-shared-dev's own apply
gh workflow run "Terraform State Plan" \
  -f target_account_alias=<alias> \
  -f terraform_component=iam-policy-management-shared-dev \
  -f operation=apply
# review: exactly 16 aws_iam_policy + 16 aws_iam_role_policy_attachment resources,
# no change to any of the fourteen pre-existing bindings
gh workflow run "Terraform State Apply" \
  -f target_account_alias=<alias> \
  -f terraform_component=iam-policy-management-shared-dev \
  -f plan_run_id=<the reviewed run id> \
  -f confirmation="APPLY <alias>"

# 2. Only then, this component's own plan
gh workflow run "Terraform State Plan" \
  -f target_account_alias=<alias> \
  -f terraform_component=compute-shared-dev \
  -f operation=apply
```

Full ten-item mandatory plan-review checklist in
[quickstart.md §3](../../specs/022-web-compute-runtime/quickstart.md). The two worth restating
here: confirm **zero** diff against `aws_lb.public`, `aws_lb_listener.public`,
`aws_ecs_cluster.main`, `aws_ecs_service.backend`, and `aws_cloudfront_distribution.main` — this
feature must add nothing that touches them — and confirm the bucket policy's `AWS:SourceArn`
names the exact new distribution ARN, never a wildcard.

## 5. Apply, and what to verify afterwards

```bash
gh workflow run "Terraform State Apply" \
  -f target_account_alias=<alias> \
  -f terraform_component=compute-shared-dev \
  -f plan_run_id=<the reviewed run id> \
  -f confirmation="APPLY <alias>"
```

```bash
WEB_BASE=$(<web_staging_base_url output>)
BUCKET=$(<web_bucket_name output>)
BASE=$(<the backend's existing staging_base_url output>)

[[ "$WEB_BASE" != "$BASE" ]] || echo "FAIL: web and backend share a hostname"          # FR-007
curl -sS -o /dev/null -w '%{http_code}\n' "https://${BUCKET}.s3.amazonaws.com/index.html"  # 403 — SC-004
curl -sS -o /dev/null -w '%{http_code}\n' "$WEB_BASE/"                                 # 200 — SPA fallback, bucket still empty here
curl -sS -o /dev/null -w '%{http_code}\n' "http://${WEB_BASE#https://}/"               # 301/302
```

**The bucket is empty at this point.** A 200 here is not proof the real build is live — an empty
bucket and a missing single asset look identical from outside, because both hit the SPA-fallback
error-response mapping. §7's recorded commit SHA is what actually proves the deployed content.

---

## 6. Diagnosis path — no access logging (deliberate, not an oversight)

Access logging on the bucket and distribution is explicitly deferred (Simplicity Budget) — this is
a stated decision from `/speckit-clarify` (Q3), not a gap discovered later. When the origin
behaves unexpectedly:

1. **CloudFront's own console metrics** (request count, error rate by status code) are the only
   infrastructure-level signal. They tell you the origin is unreachable or erroring; they cannot
   tell you whether the *content* being served is the one that was supposed to be synced.
2. **The recorded commit SHA (§7) is what answers that second question.** If the site loads but
   shows the wrong content, or shows nothing at the SPA-fallback shell, compare the running
   commit against what's recorded here — a stale or wrong sync, not an infrastructure fault, is
   the far more likely cause.
3. There is no ALB target-group health state, no ECS task status, and no circuit-breaker rollback
   to consult — none of that machinery exists for this origin, by design (User Story 2).

---

## 7. The initial deployment sync (not a Terraform step)

Per FR-017: a **manually-dispatched GitHub Actions `workflow_dispatch` run**, never an operator's
local AWS CLI session — every credential stays in CI/OIDC.

1. Confirm `web/`'s `build-test` job (lint, typecheck, test, `npm run build`) has passed for the
   commit being deployed.
2. Dispatch `.github/workflows/web-sync.yml` via `workflow_dispatch`, naming that exact commit SHA.
3. The workflow assumes `web_sync_role_arn` via OIDC, runs
   `aws s3 sync web/dist s3://<bucket> --delete`, then
   `aws cloudfront create-invalidation --distribution-id <id> --paths '/*'`.
4. **Record here**:

   | Field | Value |
   | --- | --- |
   | Commit SHA synced | *(fill in at first real dispatch)* |
   | Sync timestamp | *(fill in)* |
   | Invalidation ID | *(fill in)* |
   | Dispatched by / workflow run | *(fill in)* |

5. Verify:

```bash
curl -fsS "$WEB_BASE/"                                                    # real SPA shell content
curl -sS -o /dev/null -w '%{http_code}\n' "$WEB_BASE/callback"            # 200 — SPA fallback, not 404
```

### Recovery

Re-running step 2 against a different (earlier, known-good) commit SHA and re-invalidating is the
entire recovery procedure — no Terraform apply, mirroring SCRUM-176's forced-redeployment pattern
(REL-003). There is no automatic rollback: a bad sync stays live until a corrected one is
dispatched, which is why step 4's record is evidence, not paperwork.

---

## 8. Required follow-up (FR-019, SC-006) — do not skip

Choosing S3 + CloudFront orphaned `crewsafe/web`'s ECR repository (SCRUM-253) and `web-ci.yml`'s
`publish-image` job (SCRUM-257) — nothing runs the image they still build and push on every merge.

**This feature does not touch either** — FR-018 forbids it. A follow-up decision (retire the
pipeline, or repurpose `web-ci.yml` to build-and-sync instead) must be raised and linked here
before this feature is considered landed:

- Follow-up issue: *(link at time of raising — see tasks.md T061)*

---

## 9. Obligations this component cannot enforce

| On | Obligation |
| --- | --- |
| SCRUM-271 | Read `web_bucket_name` and `web_sync_role_arn` from this component's outputs; extend the same `workflow_dispatch` pattern §7 establishes rather than inventing a second sync mechanism |
| SCRUM-242 | Read `web_staging_base_url` to configure `CORS_ALLOWED_ORIGINS`; do not hard-code or guess the hostname |
| Whoever eventually adds a custom domain | Inherits the same TLS-floor consequence SCRUM-176's runbook §10 documents — the provider default certificate forces `TLSv1`, raising it needs an ACM certificate in `us-east-1` and DNS, not a one-line change |
| Anyone | Do not repurpose or retire `crewsafe/web`'s container pipeline without the linked follow-up (§8) actually landing first |
