# SCRUM-270 — Backend Image Publish Traceability, Promotion, and Rollback Runbook

**Workflow:** `.github/workflows/backend-ci.yml`
**Repository:** `zctiong/crewsafe`
**Region:** `ap-southeast-1`
**Upstream:** SCRUM-192 backend ECR registry, SCRUM-269 backend image scan gate

## 1. Overview

`backend-ci.yml`'s `publish-image` job builds the backend container image, scans it
(SCRUM-455, date-controlled policy — see §5), and pushes it to the `crewsafe/backend` ECR repository.
This runbook covers what SCRUM-269 does not: making a published image's identity traceable
to its source commit and CI run (SCRUM-270), and documenting how to promote and roll back
using that identity. It mirrors `docs/runbooks/SCRUM-257-build-push-web-image.md`, the
equivalent, already-shipped runbook for the web image.

## 2. Reference lookup

Every successful `publish-image` run produces a **Published Image Reference** — five values
tying the pushed image to its source commit and CI run, available in two places:

- **Job outputs** (`GITHUB_OUTPUT`, machine-consumable): `image_uri`, `image_tag`,
  `image_digest`, `run_id`, `run_url`, also exposed as the job's own `outputs:` block
  (`publish-image.outputs.image_uri`, etc.) for any downstream workflow job.
- **Job summary** (`GITHUB_STEP_SUMMARY`, human-reviewable): a "## Backend image
  publication" block on the run's Summary page listing the same five values,
  together with the report-only Trivy vulnerability summary when the image scan
  runs.

| Field | Meaning |
| --- | --- |
| `image_uri` | The full ECR reference pushed, e.g. `<account>.dkr.ecr.ap-southeast-1.amazonaws.com/crewsafe/backend:<commit-sha>` |
| `image_tag` | The immutable commit-SHA tag (`github.sha`) |
| `image_digest` | The image's content digest, `sha256:<64 hex characters>` — the only value that cannot be overwritten in the registry |
| `run_id` | The GitHub Actions run that produced this image |
| `run_url` | A direct link to that run |

To trace a deployed image back to its source: take the `image_digest` from wherever it was
recorded at deploy time, find the `publish-image` run whose job summary shows that digest,
and read `image_tag`/`run_url` from the same summary to get the exact commit and CI run.

## 3. Promotion procedure

In Sprint 2, there is no automated staging deployment that consumes this reference yet —
that is SCRUM-271's scope, not this feature's. Promotion today is a manual, documented step:

1. Identify the `publish-image` run for the commit you want to promote (via the GitHub
   Actions UI, or `gh run list --workflow backend-ci.yml`).
2. Read that run's job summary for its `image_digest`.
3. Use that digest — not the mutable `image_tag` — as the reference wherever the image is
   deployed. Once SCRUM-271 lands, this step becomes automated and this runbook will be
   updated to reflect it.

## 4. Rollback procedure

Roll back **by digest**, never by re-tagging, re-pushing, or relying on the mutable
`:<commit-sha>` tag alone:

1. Find the prior `publish-image` run you want to revert to (§2) and read its
   `image_digest` from the job summary or job outputs.
2. Deploy using that exact digest (`crewsafe/backend@sha256:<...>`), not the tag.

A commit-SHA tag (`:<commit-sha>`) can in principle be overwritten in the registry by a
re-run or a manual push, so it is not a safe rollback target on its own. A digest is
content-addressed and cannot change once pushed — it is the only reference that guarantees
you get back exactly the image you intend, byte for byte. Deploying by tag for a rollback
MUST NOT be used as a substitute for this procedure.

## 5. Date-controlled Trivy policy

The backend image scan uses the shared
`.github/scripts/security/resolve-trivy-policy-mode.sh` helper. It is **report-only through
2026-09-17 UTC**, under the temporary approval of **CrewSafe security team**. HIGH/CRITICAL
findings remain visible in the job log, redacted summary, and uploaded JSON artifact, but do
not block publication during that window. From **2026-09-18 UTC**, the same scan is blocking
and HIGH/CRITICAL findings prevent publication.

The job summary records the policy mode, owner, expiry, and evaluation date. A report-only
result with findings is not a blocking security approval. Scanner, registry, malformed-report,
identity, summary, upload, and other evidence-generation failures remain fail-closed in both
modes; report-only applies only to valid vulnerability findings.

## 6. Local/manual validation

These checks do not use AWS credentials, ECR mutation, or a live push:

```bash
.github/scripts/tests/test-backend-image-workflow.sh
.github/scripts/tests/test-resolve-trivy-policy-mode.sh
.github/scripts/tests/test-summarize-trivy-report.sh
.github/scripts/tests/test-ci-guards.sh
.github/scripts/tests/test-image-promotion-runbook.sh

# Reproduce the digest-capture logic locally (see quickstart.md for the full walkthrough)
docker build -t crewsafe-backend:local backend
docker tag crewsafe-backend:local localhost:5000/crewsafe-backend:local
docker push localhost:5000/crewsafe-backend:local
docker inspect --format='{{index .RepoDigests 0}}' localhost:5000/crewsafe-backend:local
```

Run `actionlint .github/workflows/backend-ci.yml` and `shellcheck` against the extracted
inline shell steps when those tools are available.

## 7. Failure and recovery

| State | Safe response |
| --- | --- |
| Invalid/missing `CREWSAFE_ECR_REPOSITORY_URL` or `CREWSAFE_ECR_PUSH_ROLE_ARN`, or a malformed commit SHA | The "Validate backend publication contract" step fails before any build, scan, or AWS credential step runs. Correct the repository variable and rerun the same reviewed revision. |
| Digest extraction fails or returns a malformed value | The "Push backend image and record digest" step fails after the push but before emitting outputs/summary — no Published Image Reference is produced. Re-run; if it persists, check registry/network health. |
| Scanner infrastructure failure (missing binary, database fetch failure) | The scan step fails closed regardless of report-only mode (SCRUM-269 FR-002). Retry after the underlying issue is resolved. |
| Cancelled/superseded run | Treat as non-authoritative — no reference is produced. Re-run the reviewed revision. |
| Runner/provider outage | Leave the failure visible, then retry after service recovery. |

Never broaden the push role, bypass the contract-validation step, or manually publish an
image as recovery — matching `docs/runbooks/SCRUM-257-build-push-web-image.md`'s equivalent
guidance for the web image.
