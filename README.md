# CrewSafe

[![Quality gate status](https://sonarcloud.io/api/project_badges/measure?project=zctiong-iss_crewsafe&metric=alert_status&token=7e698685c5afc1fe181a8bcfd6fff34f6d4164eb)](https://sonarcloud.io/summary/new_code?id=zctiong-iss_crewsafe)
[![Vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=zctiong-iss_crewsafe&metric=vulnerabilities&token=7e698685c5afc1fe181a8bcfd6fff34f6d4164eb)](https://sonarcloud.io/summary/new_code?id=zctiong-iss_crewsafe)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=zctiong-iss_crewsafe&metric=coverage&token=7e698685c5afc1fe181a8bcfd6fff34f6d4164eb)](https://sonarcloud.io/summary/new_code?id=zctiong-iss_crewsafe)

WBGT CrewSafe SG — a heat-stress safety platform for outdoor crews in Singapore. It
forecasts WBGT, applies a deterministic safety policy, and lets an agentic layer draft
mitigations that a supervisor approves. See
[WBGT-CrewSafe-SG-AD-Project-Plan.md](WBGT-CrewSafe-SG-AD-Project-Plan.md) for the product
and architecture source of truth, and [AGENTS.md](AGENTS.md) for the working agreement.

## At a glance

CrewSafe follows this safety-critical path:

```text
NEA weather/lightning data
        ↓
Backend ingestion, freshness and persistence
        ↓
Forecast + deterministic heat policy
        ↓
Agent-drafted mitigation (never self-authorising)
        ↓
Supervisor approve / edit / reject
        ↓
Worker dispatch, acknowledgement and audit evidence
```

Lightning is evaluated before heat rules. A lightning stop-work state visibly overrides the
heat plan, while the deterministic policy engine remains authoritative for WBGT actions. The
ML and agent layers can propose or explain a plan, but cannot bypass validation, authorization,
allowlists, approval, or audit recording.

The repository contains working backend, web, mobile, weather/lightning ingestion, and local
forecast/Bedrock spike code. The internal ML runtime, agent runtime, and mobile deployment
runtime are still product-plan targets rather than current Terraform resources; see the
[declared infrastructure limitations](docs/architecture/terraform-architecture.md#deliberate-limitations-and-follow-ups).

The supervisor console's `/insights` page adds a per-site forecast fallback-status panel
(basis ladder, degraded flag, widened interval) and a global model-accuracy panel
(MAE/RMSE, high-risk recall), both reading the existing
`GET /sites/{siteId}/weather/forecast` and `GET /api/v1/ml/model-status` contracts rather
than a new backend surface.

## Orientation

A few starting points if you're new to this repository:

- **Quality gates** — the SonarCloud badges at the top of this file reflect the live
  `main` branch quality gate, vulnerability count, and coverage; the workflows behind
  them are [.github/workflows/security-scan.yml](.github/workflows/security-scan.yml)
  and [.github/workflows/dast-staging.yml](.github/workflows/dast-staging.yml).
- **Architecture** — [docs/architecture/](docs/architecture/) has PlantUML diagrams for
  backend layering, the technology stack, Terraform/AWS topology, and the DevSecOps
  toolchain (see [More details](#more-details) below for the full list).
- **Where the safety-critical logic lives** — the deterministic WBGT policy engine and
  its authorization/audit boundary are in `backend/`; see [Security and data
  boundaries](#security-and-data-boundaries) and [docs/adr/](docs/adr/) for why each
  boundary exists, not just where.
- **Tests and how to run them** — see [Tests](#tests) below.
- **AI-assisted development** — see [AI-assisted development](#ai-assisted-development)
  for the tools used, the workflow, and the approval gates.

## Repository map

| Directory | Purpose |
| --- | --- |
| `backend/` | Java 21 Spring Boot API, Cognito resource server, Flyway migrations, weather/lightning ingestion, shifts, policy, approvals, dispatch, and audit |
| `web/` | React + TypeScript + Vite supervisor console |
| `mobile/` | React Native + Expo worker and supervisor app; mock and Cognito development modes |
| `ml-service/` | Python 3.11 FastAPI forecast baseline and Bedrock structured-output spike |
| `local/` | Podman/Docker Compose definition, local seed helpers, and launcher support |
| `infra/terraform/` | CI-only AWS Terraform roots for state, Cognito, networking, secrets, database, ECR, compute, and security integrations |
| `.github/workflows/` | Backend/web/mobile CI, security scanning, Terraform validation/plan/apply, and Cognito workflows |
| `docs/api/` | OpenAPI contracts for weather, shifts, recommendations, and action dispatch |
| `docs/adr/` | Durable architecture decisions and security boundaries |
| `docs/plans/` / `docs/runbooks/` | Jira-keyed implementation plans and operational procedures |

The [component catalogue](.github/terraform/components.json) is the authoritative list of
Terraform roots and remote state keys. The architecture diagrams describe what is declared in
this repository, not an automatically discovered live AWS inventory.

## Prerequisites

- `gh` (authenticated — `gh auth status` must succeed), `jq`, `ruby`, `curl`
- Podman or Docker, with the matching `compose` plugin
- Python 3.11+ if you want to run the ML service tests locally
- GitHub repository variables `CREWSAFE_SHARED_COGNITO_JSON` and `CREWSAFE_AWS_ACCOUNTS_JSON`,
  containing the account alias you intend to use

Local development uses the shared remote Cognito pool — see [Cognito](#cognito) below.

## Start the local stack

From the repository root:

```bash
./run.sh                  # Podman
./run-docker.sh           # Docker (same startup logic)
```

The launcher pulls the shared Cognito config, exports the `APP_COGNITO_*` / `VITE_*`
environment, writes `web/.env.local`, and starts the Compose stack detached, waiting until
PostgreSQL and the backend are healthy.

Services:

- PostgreSQL on `localhost:5434` (db/user `crewsafe`)
- Adminer on `http://localhost:8081` (database browser; Compose server `postgres`)
- Backend on `http://localhost:8080` (health at `/actuator/health`)
- Web app on `http://localhost:5173`
- Staging web frontend on [CloudFront](https://d3b75ru76gta2n.cloudfront.net)
- Staging backend API on [CloudFront](https://d2owbak275wu7r.cloudfront.net) (health at
  `/actuator/health`)

### Options

- `--account <alias>` selects the shared Cognito account alias (default `dev`)
- `--no-web` starts PostgreSQL, the backend and adminer, but not the web container. It still
  writes `web/.env.local` and leaves port 5173 free, so this is the flag to use when running
  Vite yourself — see [web/README.md](web/README.md#path-b--vite-on-your-machine)
- `--reset` deletes the local PostgreSQL volume before starting

### Logs and shutdown

```bash
podman compose -f local/compose.yaml logs -f backend web
podman compose -f local/compose.yaml down        # add -v to drop the database volume
```

Use `docker` in place of `podman` if you started the stack with `run-docker.sh`.

### Local data modes

The launcher enables weather and lightning ingestion for the local backend. To avoid external
calls and replay the bundled, clearly labelled scenario, start it with fixture data:

```bash
WEATHER_DATA_MODE=fixture ./run.sh --no-web
```

Useful overrides include `WEATHER_INGESTION_ENABLED`, `WEATHER_FIXTURE_LOOP`,
`LIGHTNING_INGESTION_ENABLED`, `LIGHTNING_FIXTURE_LOOP`, and `NEA_API_KEY`. Fixture readings
must remain visibly simulated; never use them as evidence that live NEA ingestion is healthy.

For database inspection, open Adminer at `http://localhost:8081` with server `postgres`,
database/user `crewsafe`, and the local Compose password documented in [local/README.md](local/README.md).

## Cognito

Identity for local development is a **real, deployed** Cognito pool
(`crewsafe-shared-dev`), one per AWS account alias, provisioned only through the reviewed
Terraform workflows ([ADR 0006](docs/adr/0006-shared-remote-cognito-for-development.md),
[SCRUM-154 runbook](docs/runbooks/SCRUM-154-shared-cognito.md)). Things worth knowing:

- **You need no AWS account, credentials, or profile.** An authenticated `gh` is enough —
  the launcher reads only non-sensitive pool and client IDs from the repository variables.
  No secrets are written to disk; `web/.env.local` is regenerated on every `run.sh`.
- **Login goes through the Cognito Hosted UI** (managed login, authorization code + PKCE,
  no client secret). Tokens are bearer-only, never cookies
  ([ADR 0002](docs/adr/0002-cookie-free-bearer-authentication.md),
  [ADR 0004](docs/adr/0004-aws-cognito-for-authentication.md)).
- **Cognito groups grant nothing.** `developers` and `synthetic-test-users` are
  classification and audit metadata only. CrewSafe's PostgreSQL is authoritative for role,
  site scope, and immediate revocation — a Cognito login with no application mapping is
  authenticated but unauthorized.
- **Web and backend must use the same alias.** Mixing pools fails token validation with a
  401; re-run `./run.sh --account <alias>` to resync both sides.
- **Getting your own login** is a one-time AWS Console create-user by the account owner —
  it is the only step that sends an email. Invitations expire after 30 days, and resending
  one is an exceptional Console action, so accept promptly.
- **Demo logins already exist** for `WORKER`, `SUPERVISOR`, and `SAFETY_MANAGER`
  (`synthetic-*@synthetic.crewsafe.invalid`). Passwords live in AWS Secrets Manager; ask the
  account owner. Never put a real person or personal email in that namespace. See the
  [SCRUM-190 runbook](docs/runbooks/SCRUM-190-synthetic-cognito-users.md).
- **User administration is a workflow, not a console habit** — group membership and
  lifecycle operations run through `cognito-user-administration.yml` from `main`, restricted
  to the actors listed in `.github/cognito/admins.json`.
- **`cognito-local` is test-only**, pinned for Testcontainers-based token and authorization
  tests. It is never started by `run.sh` or Compose.

## API and authorization model

The backend exposes versioned, bearer-token APIs under `/api/v1`. Site-scoped endpoints enforce
both the caller's role and membership in the requested site; worker endpoints resolve the
worker from the token instead of accepting a caller-supplied worker ID. A hidden web/mobile
control is never treated as authorization — the server remains the enforcement point.

Useful contracts and implemented surfaces:

- `GET /api/v1/sites/{siteId}/weather/latest` — latest validated/stored weather snapshot
- `GET /api/v1/sites/{siteId}/weather/forecast?horizonMinutes=30` — authorized 30/60-minute WBGT forecast
- `GET /api/v1/sites/{siteId}/lightning` — site lightning risk and validity window
- `GET /api/v1/shifts/me` — the authenticated worker's current or next shift
- `POST /api/v1/shifts/{shiftId}/readiness` — append-only worker readiness submission
- `GET /api/v1/sites/{siteId}/shifts` — site-scoped shift planning surface
- `GET /api/v1/sites/{siteId}/shifts/{shiftId}/recommendations` — draft recommendations
- `POST /api/v1/sites/{siteId}/shifts/{shiftId}/recommendations/{recommendationId}/decision` —
  supervisor approval, edit, or rejection
- `POST /api/action-dispatch/{dispatchId}/acknowledge` — worker acknowledgement

The matching OpenAPI files live in [`docs/api/`](docs/api/). The ML and Bedrock spike proxy
under `/api/test/bedrock` is for integration testing, not a public supervisor API.

## Security and data boundaries

- No secrets, tokens, Terraform state, saved plans, or personal data belong in Git or logs.
- Cognito authenticates users; PostgreSQL application records determine role, site scope, and
  immediate revocation.
- Weather and lightning credentials are server-side only. Clients consume validated snapshots
  with source and freshness metadata.
- AI output is an untrusted draft. Server-side action allowlists and supervisor approval sit
  between a suggestion and any worker dispatch.
- Audit events preserve recommendation, approval, dispatch, acknowledgement, and safety
  decisions for later review.
- AWS changes use GitHub OIDC and reviewed CI workflows. Do not run Terraform locally, use a
  workstation AWS profile, or apply an unreviewed plan.

See the [security ADRs](docs/adr/) and the [DevSecOps toolchain diagram](docs/architecture/devsecops-toolchain.puml)
for the detailed control boundaries.

## AI-assisted development

Parts of this repository — code, tests, docs, and infrastructure — were written with AI
coding assistants working alongside the team, not autonomously:

- **Tools used:** [Claude Code](https://claude.com/claude-code) (Anthropic) and
  [OpenAI Codex](https://openai.com/codex/). Both operate under the same working
  agreement, [AGENTS.md](AGENTS.md), which also fixes which model handles which class of
  decision (`AGENTS.md` §6.2.1–§6.2.2) — for example, higher-consequence work such as
  Terraform, authorization, and migrations always requires the implementation-tier model
  plus human adjudication, never the drafting-tier model alone.
- **Workflow:** feature work runs through a spec-first cycle (specify → clarify → plan →
  tasks → analyze → **explicit human approval** → implement → final review) described in
  `AGENTS.md` §6. Two review gates — after the spec and after the plan — are mandatory
  stops; an agent does not write production code before a human has approved the plan.
- **What AI never does unsupervised:** the deterministic WBGT safety policy, authorization
  checks, database migrations, and any Terraform `apply` are excluded from autonomous
  agent action by [AGENTS.md](AGENTS.md) §3 and require human review regardless of which
  tool drafted the change.
- **Attribution:** commits with AI-assisted authorship carry a `Co-Authored-By:` trailer
  naming the tool/model that helped (for example, `Co-Authored-By: Claude Sonnet 5
  <noreply@anthropic.com>`) — visible in `git log`, not asserted only in this file.
- Every PR is still opened, reviewed, and merged by a human maintainer; CI (tests, SAST/SCA,
  container/DAST scanning, Terraform plan review) applies identically regardless of whether
  a change was AI-assisted.

## Tests

```bash
(cd backend && ./mvnw verify)              # backend compile + tests
.github/scripts/tests/test-ci-guards.sh

(cd web && npm test && npm run typecheck)
(cd mobile && npm test && npm run typecheck)
(cd ml-service && python3 -m pytest -q)
```

The web, mobile, and ML commands require their local dependencies to be installed. The ML
tests are forecast/contract tests and do not require Bedrock access. Terraform validation and
deployment remain CI-only — never run Terraform locally.

Terraform runs in CI only — never locally. See
[docs/runbooks/](docs/runbooks/).

The normal promotion path is:

1. Open a focused branch and pull request linked to its Jira issue.
2. Let backend, web, mobile, secret-scan, SAST/SCA, IaC, and guard self-tests run.
3. Review the exact Terraform plan in CI when infrastructure is in scope.
4. Apply only from `main` through the manual workflow with the required typed confirmation.
5. Keep the plan, test output, scan results, and deployment evidence with the review.

## More details

- [web/README.md](web/README.md) — supervisor console: both run paths and its decisions
- [mobile/README.md](mobile/README.md) — Expo app: the three sign-in modes, why Expo Go
  cannot use the Hosted UI, and every backend gap it works around
- [local/README.md](local/README.md) — Compose stack layout and resolved environment
- [docs/architecture/terraform-architecture.md](docs/architecture/terraform-architecture.md) —
  Terraform component and runtime boundaries
- [docs/architecture/backend-architecture.puml](docs/architecture/backend-architecture.puml) —
  backend software layering: identity boundary, controllers, deterministic safety policy,
  persistence, and the agent layer's draft-only relationship to the service layer
- [docs/architecture/technology-stack.puml](docs/architecture/technology-stack.puml) —
  full stack inventory mapped to the repository's top-level folders
- [docs/architecture/devsecops-toolchain.puml](docs/architecture/devsecops-toolchain.puml) —
  DevSecOps toolchain diagram (open with PlantUML or export for presentations)
- [SCRUM-111 weather ingestion](docs/runbooks/SCRUM-111-weather-ingestion.md) — external
  data.gov.sg endpoints, live and fixture modes, scheduling, and troubleshooting
- [docs/adr/](docs/adr/) — architecture decisions
- [docs/plans/](docs/plans/) — Jira-keyed plans
- [docs/demo/login-demo.gif](docs/demo/login-demo.gif) — sign-in and role-routing walkthrough
