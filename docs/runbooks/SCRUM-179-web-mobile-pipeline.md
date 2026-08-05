# SCRUM-179 — Web and mobile CI pipeline

Operating guide for `.github/workflows/web-ci.yml` and
`.github/workflows/mobile-ci.yml`. The workflows validate their respective
frontend source trees only. They do not deploy, publish, mutate repository
state, or use cloud credentials.

## What runs, and when

| Check | Working directory | Required commands | Trigger paths |
|---|---|---|---|
| `Web CI` (`web-ci.yml`) | `web/` | `npm ci`, lint, type-check, unit tests, production build | `web/**`, `.github/workflows/web-ci.yml`, `.github/scripts/tests/**` |
| `Mobile CI` (`mobile-ci.yml`) | `mobile/` | `npm ci`, lint, type-check, iOS Expo export, Android Expo export | `mobile/**`, `.github/workflows/mobile-ci.yml`, `.github/scripts/tests/**` |

Pull requests and pushes target `main`, and each workflow supports an explicit
`workflow_dispatch` run. A web-only change runs only `Web CI`; a mobile-only
change runs only `Mobile CI`; a change under `.github/scripts/tests/**` runs
both workflows. Changes unrelated to either frontend or shared CI inputs run
neither workflow automatically.

The workflow checks out the pull-request head SHA (or `github.sha` outside a
pull request), uses Node.js 22, installs only from the committed lockfile, and
pins action references to immutable commit SHAs.

## Local validation

Run the same commands used by CI:

```sh
cd web
npm ci
npm run lint
npm run typecheck
npm test
npm run build

cd ../mobile
npm ci
npm run lint
npm run typecheck
npm run build
```

The mobile build runs both:

```sh
expo export --platform ios
expo export --platform android
```

Signed native binaries, EAS builds, release signing, and publishing are out of
scope. `dist/`, `node_modules/`, and local environment files must remain
ignored and must not be committed.

## Required branch protection

A repository maintainer must configure `main` to require these exact status
checks:

- `Web CI`
- `Mobile CI`

Use the repository branch-protection settings to require status checks before
merge and require the branch to be up to date before merging. Do not configure
job-level path skips or substitute a differently named check. A failed,
cancelled, missing, or stale result must not satisfy the gate.

Verify the configuration with:

1. A pull request that changes a frontend and passes both jobs.
2. A pull request with an injected web TypeScript error; `Web CI` must fail and
   merge must remain blocked.
3. A pull request with an injected mobile TypeScript error; `Mobile CI` must
   fail and merge must remain blocked.
4. A pull request changing only `web/**`; only `Web CI` must run.
5. A pull request changing only `mobile/**`; only `Mobile CI` must run.
6. A pull request changing only an unrelated path; neither workflow must run.
7. A pull request changing `.github/scripts/tests/**`; both workflows must run.

Record the pull-request URLs and workflow run IDs in the SCRUM-179 review. Do
not paste credentials, environment values, or full secret-bearing logs into
the review.

## Failure diagnostics

| Symptom | Action |
|---|---|
| `npm ci` fails | Confirm the matching lockfile is present and committed; do not replace it with a non-immutable install. |
| Lint or type-check fails | Use the named job and step log; correct the source/configuration failure and rerun the current revision. |
| Web unit test fails | Fix the failing test; a successful build does not override a failed test step. |
| Either mobile export fails | Treat `Mobile CI` as failed; inspect the platform-specific Metro output. |
| Runner or registry outage | Rerun the same revision after service recovery; an unavailable dependency service must never be treated as success. |
| Result is stale or cancelled | It cannot satisfy branch protection; rerun the current revision. |
| Unexpected credential or environment output | Stop, rotate any exposed credential at its source, remove the output, and run the repository secret scan. |

## Rollback and recovery

Revert workflow or manifest changes through a reviewed pull request. Do not
disable required checks as a workaround for a failing implementation. If the
workflow must be disabled temporarily, record the reason and owner, and restore
the workflow and required checks before accepting frontend changes.

## Validation evidence

The implementation review must attach:

- split frontend workflow guard results: 62 checks, 0 failures;
- frontend manifest guard results: 21 checks, 0 failures;
- actionlint passed for both `web-ci.yml` and `mobile-ci.yml`;
- explicit path-boundary checks passed: web-only and mobile-only changes exclude
  the unrelated workflow, while shared test-input paths are present in both;
- clean-checkout positive results for both projects;
- missing-lockfile, failed-step, injected-type-error, and mobile
  platform-export failure results;
- actionlint output for both `web-ci.yml` and `mobile-ci.yml`, when available;
- gitleaks implementation-scope scan: 0 findings;
- npm audit results: web 0 high/critical and 2 moderate; mobile 0 high/critical and 12 moderate;
  do not run `npm audit fix --force` without a separate dependency review;
- Node 22 Linux container equivalent timing evidence: 20 clean-fixture runs per
  frontend passed; Web CI ranged from 10–11 seconds with p95 11 seconds, and
  Mobile CI ranged from 26–39 seconds with p95 39 seconds. Cached valid reruns
  completed in 7 seconds for web and 24 seconds for mobile. No provider outage
  or rerun was required in the sample.

The same sample must be repeated on the GitHub-hosted runner after the workflow
is available remotely; retain the run IDs with the review evidence.

No Spec Kit files under `specs/**` are production artifacts and they must not be
committed.
