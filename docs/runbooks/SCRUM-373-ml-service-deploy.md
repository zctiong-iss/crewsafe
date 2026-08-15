# SCRUM-373 ml-service ECS Sidecar Deploy Runbook

**Components changed**: `ecr-shared-dev` (`infra/terraform/ecr`), `secrets-shared-dev`
(`infra/terraform/secrets`), `compute-shared-dev` (`infra/terraform/compute`),
`iam-policy-management-shared-dev` (`infra/terraform/iam-policy-management`),
`.github/workflows/ml-service-ci.yml` · No new component, no new Terraform state.

This runbook covers what `ml-service` looks like once deployed, how it's coupled to `backend`'s
own deploy/scale/crash lifecycle, how to redeploy or roll it back, and the real failures live
testing hit. See [Activating a trained model](#8-activating-a-trained-model) for what a data
scientist needs to do to move `/forecast` off the persistence baseline — a separate, later step
this issue deliberately does not include.

> **Never run Terraform against a real account from a workstation** (`AGENTS.md` §3). Every
> Terraform change here is a CI dispatch: **Terraform State Plan** then a typed
> `APPLY <alias>` confirmation on **Terraform State Apply**. The commands below are ordinary AWS
> CLI calls against already-applied infrastructure, or GitHub Actions `workflow_dispatch` calls —
> neither is a Terraform apply.

## 1. What this feature deploys

`ml-service` runs as a **second container inside the existing `crewsafe-shared-dev-backend` ECS
task** — not a separate service, not behind the ALB, not reachable from outside the task. Fargate
`awsvpc` mode gives every container in a task the same ENI, so `backend` already reaches it over
`localhost:8000` — matching `backend`'s own `FORECAST_BASE_URL`/`BEDROCK_API_URL` defaults, which
is why no service-discovery entry, ALB target group, listener rule, or security-group ingress was
added.

| Property | Value |
| --- | --- |
| Container name | `ml-service` |
| Image | `<ml_service_repository_url>:<tag>` (`crewsafe/ml-service` in ECR, immutable tags) |
| Port | `8000`, container-internal only — no `portMappings` referenced by any ALB/listener/security-group resource |
| `essential` | `true` — see [§4](#4-crashlifecycle-coupling-with-backend) |
| User | `1000` (non-root, matching the image's own `useradd -m -u 1000 appuser`) |
| `readonlyRootFilesystem` | `true` — a stronger posture than `backend`'s own (documented) `false` exception; the image is already `chmod 444`/read-only at build time (research.md R-010) |
| Log group | `/crewsafe/shared-dev/ml-service` — separate CloudWatch log group from `backend`'s own, so a failure is attributable to the right container |
| Environment | Two secrets-only entries, `WBGT_MODEL_MANIFEST`/`WBGT_MODEL_MANIFEST_SHA256`, resolved from SSM (`/crewsafe/shared-dev/ml/model-manifest*`) — both currently the placeholder value `"unset"` (§8) |
| Health check | The image's own `HEALTHCHECK` (`GET /health` via the standard-library HTTP client, `interval=10s timeout=5s start-period=10s retries=3`) |
| Task sizing | `task_cpu = 1024` / `task_memory = 4096` (up from `512`/`1024` when the task ran `backend` alone) — reasoned headroom for both containers together, not a benchmarked figure (research.md R-007) |
| IAM | No new task-role grant *for ml-service specifically* beyond the Bedrock statements — `backend`'s task role already covers both containers, since ECS grants task-level IAM per task, not per container |

## 2. Discover the running task

```bash
export AWS_PROFILE=crewsafe-shared-dev

TASK_ARN=$(aws ecs list-tasks --cluster crewsafe-shared-dev --service-name backend \
  --desired-status RUNNING --query 'taskArns[0]' --output text)
TASK_ID=$(basename "$TASK_ARN")

aws ecs describe-tasks --cluster crewsafe-shared-dev --tasks "$TASK_ID" \
  --query 'tasks[0].containers[*].{name:name,status:lastStatus,health:healthStatus}'
# expect two entries: backend and ml-service, both RUNNING / HEALTHY
```

## 3. Applying a change — two steps, not one

`aws_ecs_service.backend` carries `lifecycle { ignore_changes = [task_definition, desired_count] }`
— a deliberate, documented divergence (see `compute/main.tf`'s own "THE DECLARED DIVERGENCE"
comment). **A `compute` Terraform apply only registers a new task-definition revision; it does not
roll that revision onto the live service** (research.md R-011, discovered live during this
feature's own implementation). Any change to `ml-service`'s container definition, image tag, or
task sizing needs both of the following, in order:

1. **Terraform apply** — `compute-shared-dev`, via the normal Plan → typed `APPLY` → Apply
   sequence. Confirm the plan shows `aws_ecs_task_definition.backend` as an **in-place update**
   registering a new revision — never a replacement.
2. **Backend redeploy** — GitHub Actions → **Backend CI** → **Run workflow**, with `redeploy: true`
   and `redeploy_image_tag` set to the commit SHA of the `backend` image currently running in
   `crewsafe-shared-dev` (no new backend code change is implied). This dispatches
   `deploy-backend-staging.sh`, which fetches the **current registered** task-definition revision
   (now including step 1's `ml-service` container), rewrites only the `backend` container's
   `image` field, registers a fresh revision, and force-deploys it — this is what actually carries
   `ml-service` into the live service.

Skipping step 2 after step 1 is the single most likely way to see "the apply succeeded but nothing
changed" — the registered revision exists, the running task doesn't reflect it yet.

## 4. Crash/lifecycle coupling with `backend`

**Known, accepted trade-off** (not a defect): `ml-service` is `essential = true`. If it fails its
health check or its process exits, ECS stops the **entire task** — `backend` goes down with it,
even though `backend` itself is healthy. This is the same failure semantics as any other essential
container; sidecar placement was chosen because `backend`'s own configuration already assumed
`ml-service` runs alongside it (`FORECAST_BASE_URL`/`BEDROCK_API_URL` default to `localhost:8000`),
not because independent scaling was evaluated and rejected. Revisit if `ml-service` ever needs to
scale independently of `backend`.

Both containers share:

- **Deploy**: one task definition, one `aws_ecs_service.backend`. There is no way to deploy
  `ml-service` without also registering a `backend`-inclusive revision, and no way to redeploy
  `backend` without carrying whatever `ml-service` image tag `compute` last registered.
- **Scale**: `desired_count` scales the whole task, both containers together. There is no
  independent `ml-service` replica count.
- **Crash**: see above — either container's fatal failure takes down both.

They do **not** share a log stream (§1) or an IAM identity distinction — task-level IAM applies to
the whole task, so `ml-service` and `backend` both run under the same task role
(`crewsafe-shared-dev-task`), including the Bedrock grant `ml-service` actually uses.

## 5. Rollback

Task-definition revisions are immutable and cumulative — rolling back means re-pointing the
service at an older revision, not deleting anything.

```bash
# Find the previous known-good revision
aws ecs list-task-definitions --family-prefix crewsafe-shared-dev-backend \
  --sort DESC --query 'taskDefinitionArns[0:5]'

# Point the live service at a specific prior revision and force a fresh deployment
aws ecs update-service --cluster crewsafe-shared-dev --service backend \
  --task-definition crewsafe-shared-dev-backend:<REVISION_NUMBER> \
  --force-new-deployment
```

Confirm the rollback took effect the same way as §2 — both containers `RUNNING`/`HEALTHY`, and
`aws ecs describe-tasks ... --query 'tasks[0].taskDefinitionArn'` naming the expected older
revision. A revision from before this feature shipped has only the `backend` container — rolling
back that far removes `ml-service` entirely, which is a valid way to fully back out this feature's
live effect without touching Terraform state.

If the *cause* was a bad `ml-service` image rather than a Terraform misconfiguration, prefer fixing
forward (push a corrected image, re-run `ml-service-ci.yml`'s `publish-image` job, re-apply
`compute` with the new tag, redeploy per §3) over a long-lived rollback — the placeholder
model-manifest state (§8) means `ml-service` has no persistent state of its own to reconcile.

## 6. Troubleshooting — real failures hit during live testing

| Symptom | Cause | Fix |
| --- | --- | --- |
| `secrets` apply fails: `ValidationException: ... Member must have length greater than or equal to 1` on `aws_ssm_parameter.config["ml/model-manifest"]` | AWS SSM's `PutParameter` rejects an actually-empty string value. | Already fixed in the shipped Terraform — the two model-manifest parameters use the placeholder value `"unset"`, not `""` (research.md R-001's amendment). If this recurs, something reverted that placeholder. |
| `compute` apply succeeds, but `ml-service`/`backend` still behave as before | The two-step coupling in §3 — a `compute` apply alone never rolls onto the live service (`ignore_changes`). | Dispatch the backend redeploy (§3 step 2). |
| `GET /bedrock/access` or `POST /mitigations` returns `AccessDeniedException`, naming a `foundation-model` ARN | AWS's `global.` cross-Region inference profile requires a **three-part** IAM policy: the profile ARN, the regional foundation-model ARN, *and* the region-less global foundation-model ARN — all three, not any one of them (confirmed against AWS's own `global-cross-region-inference` documentation after two live rounds each denied a different one of the two foundation-model ARN shapes). | Confirm `secrets/main.tf`'s `local.task_policy` carries all four Bedrock statements (`InvokeMitigationSuggestionModel`, `InvokeBedrockAccessVerificationProfile`, `InvokeBedrockAccessVerificationFoundationModel`, `InvokeBedrockAccessVerificationFoundationModelGlobal`) — see `contracts/bedrock-invoke-grant.md`. IAM policy changes apply live to an already-running task without a redeploy; if the four statements are all present and this still recurs, re-check the exact ARN in the denial against each statement's `Resource`. |
| `POST /forecast` returns `503` with `code=FORECAST_MODEL_UNAVAILABLE` | **Expected**, not a bug, as long as no model is activated (§8). A request that supplies observation `context` hits the trained-model branch; with `WBGT_MODEL_MANIFEST` still `"unset"`, that branch always fails safely rather than crashing. A request **without** `context` still serves the `baseline-1.0.0` persistence result. | Nothing to fix unless a model has been activated per §8 and this still occurs — that would indicate the manifest/checksum parameters are wrong or the container hasn't picked up the redeploy (§3). |
| Direct `curl` from inside the task (ECS Exec) fails with `AccessDeniedException` on `ecs:ExecuteCommand`, naming the **cluster** ARN | A separate, already-merged SCRUM-371 gap: the `crewsafe-developers` group's `ecs:ExecuteCommand` grant is scoped to the task ARN pattern, but this specific authorization check requires the cluster ARN too. Not something this feature's own Terraform touches. | Out of scope for this feature. Verify `ml-service` behavior via its own CloudWatch log stream (`/crewsafe/shared-dev/ml-service`) instead — sufficient for every live check this feature needed. Fixing the SCRUM-371 gap is separate follow-up work. |

## 7. What this does not grant or do

- No ALB target group, listener rule, or security-group ingress — `ml-service` is unreachable from
  outside the task, by design (spec Goal).
- No S3 access on either identity — a model bundle shipped via S3 rather than baked into the image
  is explicitly deferred to a follow-up issue (spec FR-009).
- No independent scaling, deploy, or IAM identity for `ml-service` — see §4.
- No change to `backend`'s own container definition, image, or authentication — this feature adds
  a sidecar, it does not modify `backend`.

## 8. Activating a trained model

Today, `WBGT_MODEL_MANIFEST`/`WBGT_MODEL_MANIFEST_SHA256` are both the literal placeholder value
`"unset"` (research.md R-001) — deliberately, not a bug. `/forecast` always serves the
`baseline-1.0.0` persistence result; any request that includes observation `context` fails safely
with `503 FORECAST_MODEL_UNAVAILABLE` rather than a stack trace, because
`ForecastModelRegistry.from_environment()` (`ml-service/crewsafe_ml/inference.py:53`) treats
`"unset"` as an unresolvable path.

### 8.1 The existing candidate — a different AWS account

A trained candidate already exists, from a SageMaker Studio experiment. It is **not**
`approved_for_inference` — there is nothing to activate without the steps below. Its inventory,
as of this issue:

| Item | Value |
| --- | --- |
| AWS account | `087819194272` — **not** the account `secrets`/`compute`/`ecr` deploy to |
| AWS region | `ap-southeast-2` — **not** `ap-southeast-1`, the only region `secrets/variables.tf` accepts |
| S3 bucket | `amazon-sagemaker-087819194272-ap-southeast-2-6vwrp2nvum4psy` |
| Training input prefix | `shared/crewsafe-wbgt-experiment/input/` — `weather_readings.csv`, `manifest.json` |
| Experiment output prefix | `shared/crewsafe-wbgt-experiment/output/wbgt-sagemaker-experiment-v1/` — `forecast-30m.joblib`, `forecast-60m.joblib`, `evaluation-30m.json`, `evaluation-60m.json`, `manifest.json` |
| Model version | `wbgt-sagemaker-experiment-v1` |
| Feature version | `wbgt-features-1.2.0` — matches `crewsafe_ml/features.py`'s `FEATURE_VERSION` exactly, so this candidate is schema-compatible with today's code, not stale |
| `approved_for_inference` | `false` in the generated manifest |

**This is a separate, untrusted-by-Terraform AWS account** — no cross-account IAM trust exists
between it and `secrets`/`compute`'s account, and none is being added: this issue's design
deliberately grants **no S3 access at all** to either ECS identity (§7, spec FR-009). Pulling
these files is a manual, out-of-band step a developer with access to that account performs on
their own workstation — not something Terraform, CI, or the running task does. Getting read
access to account `087819194272` in the first place is itself out of band; this repository has
no bearing on that account's own IAM and this runbook does not cover requesting it.

### 8.2 Steps to activate it

Promoting a model is designed to be a **value-only change** to this repository — no
task-definition edit, no Terraform-shape change — because the manifest itself is baked into the
`ml-service` image (no runtime S3 fetch, §7) and only the two SSM parameter *values* change.

1. **Pull the frozen candidate down** from the S3 location in §8.1 (needs separate read access to
   account `087819194272`) — at minimum the output prefix's `manifest.json`,
   `forecast-30m.joblib`, `forecast-60m.joblib`; also the input prefix's `manifest.json` to learn
   the training data's end date, needed for step 2's window. Never copy that account's
   credentials into this repository, Terraform variables, or any file here.
2. **Download a *fresh*, untouched evaluation dataset** — this is not in that S3 bucket; approval
   requires data the candidate has never seen. Run `ml-service`'s own
   `python -m crewsafe_ml.download_dataset` against the live NEA/data.gov.sg API (needs
   `NEA_API_KEY`), for a period that starts **after both** the training data's end date and the
   candidate's own creation date, spanning at least `DEFAULT_MINIMUM_UNTOUCHED_DAYS` (21) days.
   Use a separate output folder from any training download — `ml-service/README.md`'s WBGT
   training workflow section has the exact command shape.
3. **Confirm the manifest matches the schema** `ForecastModelRegistry.load()` validates
   (`ml-service/crewsafe_ml/inference.py:65-104`) before evaluating or activating it:
   - `schema_version: 2`
   - `model_version` (string), `numeric_features`/`categorical_features` (non-empty string lists
     matching `crewsafe_ml/features.py`'s feature frame)
   - `horizons`: an object with both `"30"` and `"60"` keys, each naming a `selected_model`
     (`"persistence"`, or a real model requiring an `artifact` filename + `artifact_sha256`) and an
     `interval_half_width`
   - Any non-`persistence` horizon's `artifact` file (a `joblib`-loadable estimator, e.g. the
     pulled-down `forecast-30m.joblib`/`forecast-60m.joblib`) must sit in the **same directory** as
     the manifest — `_verified_artifact_path()` refuses a path that escapes that directory, and
     checks its own SHA-256 against `artifact_sha256`.
   - `approved_for_inference: true` and no `approval_blocker` — **not** set yet at this point; see
     step 5.
4. **Get it formally evaluated** — `ml-service/crewsafe_ml/approval_evaluation.py`
   (`evaluate_frozen_candidate()`) produces the review evidence, run locally against the
   pulled-down manifest (with its checksum) and step 2's freshly downloaded, untouched dataset.
   This script "deliberately cannot modify or approve a model manifest; promotion remains a
   separate human-reviewed action" (its own module docstring) — it only produces a report.
5. **A human reviews the report and sets `approved_for_inference: true`** on the local manifest
   copy — nothing is written back to the SageMaker account's S3, and no script sets this flag
   automatically.
6. **Bake the approved manifest and artifact(s) into the `ml-service` image** — build them in at a
   fixed, known path (there is no runtime volume or S3 fetch in this feature's design), publish
   via `ml-service-ci.yml`'s `publish-image` job as normal.
7. **Update the two SSM parameter values only** — `infra/terraform/secrets/main.tf`'s
   `local.config_parameters["ml/model-manifest"]` (the in-image path) and
   `["ml/model-manifest-sha256"]` (the manifest file's own SHA-256, **not** an artifact's) — from
   `"unset"` to the real values, through the normal Plan → Apply cycle. No `compute` change, no new
   container definition, no image-tag bump beyond whatever step 6 already published.
8. **Redeploy is still required** — even a parameter-value-only `secrets` apply needs the same
   §3 backend redeploy to force the running container to re-resolve the SSM secret at task start;
   ECS does not hot-reload a container's environment from a changed parameter value on a task
   that's already running.
9. **Re-verify**: a `/forecast` call **with** `context` should now return a real model prediction
   (`model_version` in the response naming the manifest's own `model_version:selected_model`)
   instead of `503`; a call **without** `context` should be unaffected (still `baseline-1.0.0` —
   that branch never consults the model registry).
