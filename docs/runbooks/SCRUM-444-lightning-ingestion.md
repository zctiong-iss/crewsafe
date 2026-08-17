# SCRUM-444 — Enable staging lightning ingestion

This runbook enables the existing lightning ingestion scheduler in the shared staging backend.
It addresses the missing staging configuration that leaves the scheduler disabled by the
application’s safe default. It does not change lightning risk derivation, REST authorization,
database schema, or the separate SSE response-format defect.

## Ownership boundary

| Concern | Owner | Evidence |
| --- | --- | --- |
| SSM configuration parameter | `secrets-shared-dev` Terraform component | Reviewed CI plan/apply adds `/crewsafe/shared-dev/lightning/ingestion-enabled` as a String with value `true` |
| ECS task-definition reference | `compute-shared-dev` Terraform component | Reviewed CI plan/apply adds `LIGHTNING_INGESTION_ENABLED` under the existing parameter prefix |
| Running task revision | Backend CI deployment script | Backend CI redeploy output and completed ECS rollout |
| Lightning observations | Existing backend scheduler and persistence path | Sanitized category-level ingestion outcome and authorized endpoint result |

Terraform owns the infrastructure shape. Backend CI owns promotion of the running task revision;
`aws_ecs_service.backend` intentionally ignores task-definition drift. Do not remove that boundary
or apply Terraform from a workstation.

## Preconditions

- SCRUM-444 is approved for staging and the relevant Terraform plan is reviewed.
- The `secrets-shared-dev` and `compute-shared-dev` CI plan/apply workflows target the intended
  staging account and `ap-southeast-1`.
- An approved immutable backend image tag reachable from `main` is available for Backend CI
  `redeploy=true`.
- The operator has an authenticated staging test identity and an approved seeded site ID.

## Enable and deploy

1. Run the reviewed Terraform plan for `secrets-shared-dev`. Confirm the plan creates or updates
   exactly one non-secret String parameter:

   ```text
   /crewsafe/shared-dev/lightning/ingestion-enabled = true
   ```

2. Run the reviewed Terraform plan for `compute-shared-dev`. Confirm the backend task definition
   contains exactly one managed reference:

   ```text
   name: LIGHTNING_INGESTION_ENABLED
   valueFrom: .../parameter/crewsafe/shared-dev/lightning/ingestion-enabled
   ```

   Confirm the backend container’s plaintext `environment` list remains empty.

3. Apply both reviewed plans through the approved CI apply workflow. Do not paste credentials,
   state, or saved plan artifacts into Jira, chat, or local files.

4. Run Backend CI on `main` with `redeploy=true` and the approved existing immutable image tag.
   The deployment script reads the current registered task definition, verifies the lightning
   reference, registers the image-digest revision, forces a fresh deployment, and waits for
   rollout completion.

5. Wait for the existing staging smoke workflow. Record only the task-definition ARN/revision,
   image commit identifier, rollout result, and workflow URLs.

## Verify ingestion and readings

After the fresh task reports healthy:

1. Wait through the configured five-second initial delay plus enough time for the existing
   two-minute cadence.
2. Inspect sanitized backend logs for one of these category-level outcomes:

   ```text
   NEA lightning ingestion completed
   nea_lightning_ingestion_failed_retry_scheduled
   ```

   The second outcome proves the scheduler is active but the external feed failed safely. It is
   not evidence of a disabled scheduler.

3. For every configured seeded site, use the approved authenticated verification path to call:

   ```text
   GET /api/v1/sites/{siteId}/lightning
   GET /api/v1/sites/{siteId}/lightning/observations
   ```

   Verify the result within 60 seconds of a successful tick:

   - a successful empty strike set is a valid observation with no nearest strike, not missing
     ingestion;
   - a current-risk response remains `no data` when no observation exists, rather than becoming
     `CLEAR`; and
   - source, freshness, timestamp, and existing authorization semantics remain intact.

4. Verify an unauthorized or out-of-site caller remains denied. Do not include tokens or user
   identifiers in the evidence.

5. If an SSE request reports `HttpMessageNotWritableException`, record it separately as the
   existing stream transport defect. It must not be used as proof that lightning ingestion is
   disabled or as a reason to change this configuration.

## Performance and reliability evidence

Record sanitized staging measurements for:

- lightning endpoint p95, target below 1 second;
- time from successful upstream tick to readable observation, target within 60 seconds; and
- observed scheduler cadence, target two minutes after the initial delay.

Attach only aggregate timings and workflow/run identifiers to the review. Never attach raw task
definitions, SSM responses, Terraform state, access tokens, or credentials.

## Failure interpretation

| Symptom | Meaning | Action |
| --- | --- | --- |
| Deployment guard says the task definition lacks the lightning reference | The reviewed compute configuration has not been applied or the wrong task-definition family was read | Stop; run the reviewed compute plan/apply, then retry Backend CI redeploy |
| Fresh task has no scheduler outcome | Task replacement or configuration resolution is incomplete | Check the promoted task revision and rollout result; do not change the application default |
| `nea_lightning_ingestion_failed_retry_scheduled` | Scheduler is enabled and the upstream attempt failed | Preserve the evidence and allow the next cadence retry; investigate upstream availability separately |
| History is empty after a successful empty-set tick | Check the endpoint or persistence contract | A quiet tick should still create one valid per-site observation |
| SSE response-format error | Separate stream transport issue | Track as a follow-up; do not conflate with ingestion configuration |

## Rollback

To disable staging ingestion:

1. Create a reviewed CI plan changing the same SSM parameter value to `false`.
2. Apply through the approved CI workflow.
3. Run Backend CI `redeploy=true` with the approved immutable image so fresh tasks resolve the
   disabled value.
4. Verify rollout completion and record that subsequent logs no longer show lightning scheduler
   outcomes.

The application default remains `${LIGHTNING_INGESTION_ENABLED:false}`. Never change it to enable
staging, and never apply Terraform or query AWS credentials from a workstation.
