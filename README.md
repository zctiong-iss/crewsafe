# CrewSafe

WBGT CrewSafe SG — a heat-stress safety platform for outdoor crews in Singapore. It
forecasts WBGT, applies a deterministic safety policy, and lets an agentic layer draft
mitigations that a supervisor approves. See
[WBGT-CrewSafe-SG-AD-Project-Plan.md](WBGT-CrewSafe-SG-AD-Project-Plan.md) for the product
and architecture source of truth, and [AGENTS.md](AGENTS.md) for the working agreement.

## Prerequisites

- `gh` (authenticated — `gh auth status` must succeed), `jq`, `ruby`, `curl`
- Podman or Docker, with the matching `compose` plugin
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
- Backend on `http://localhost:8080` (health at `/actuator/health`)
- Web app on `http://localhost:5173`

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

## Tests

```bash
cd backend && ./mvnw verify         # backend compile + tests
.github/scripts/tests/test-ci-guards.sh
```

Terraform runs in CI only — never locally. See
[docs/runbooks/](docs/runbooks/).

## More details

- [web/README.md](web/README.md) — supervisor console: both run paths and its decisions
- [mobile/README.md](mobile/README.md) — Expo app: the three sign-in modes, why Expo Go
  cannot use the Hosted UI, and every backend gap it works around
- [local/README.md](local/README.md) — Compose stack layout and resolved environment
- [SCRUM-111 weather ingestion](docs/runbooks/SCRUM-111-weather-ingestion.md) — external
  data.gov.sg endpoints, live and fixture modes, scheduling, and troubleshooting
- [docs/adr/](docs/adr/) — architecture decisions
- [docs/plans/](docs/plans/) — Jira-keyed plans
