# Local Compose Stack

This directory contains the local development stack for CrewSafe.

## What it starts

- `postgres` on host port `5434`
- `adminer` on host port `8081` (database browser; server `postgres` inside Compose)
- `backend` on host port `8080`
- `web` on host port `5173`

The stack is meant to be started from the repository root with:

```bash
./run.sh
./run-docker.sh
```

`run.sh` defaults to Podman. `run-docker.sh` selects Docker and delegates to the same startup logic.

The default account alias is `dev`. Pass `--account <alias>` to select a different one.

## Cognito

Normal local development uses the shared remote Cognito pool described in ADR 0006.
There is no local Cognito emulator in this stack.

Before starting the stack, make sure:

- `gh auth status` succeeds
- `CREWSAFE_SHARED_COGNITO_JSON` is available through GitHub repository variables
- the selected account alias exists in that shared Cognito config

The launcher resolves the required environment for the application containers:

- `APP_COGNITO_ISSUER_URI`
- `APP_COGNITO_JWK_SET_URI`
- `APP_COGNITO_CLIENT_IDS`
- `APP_COGNITO_DEMO_USERS_JSON`
- `VITE_COGNITO_AUTHORITY`
- `VITE_COGNITO_CLIENT_ID`
- `VITE_COGNITO_HOSTED_UI_DOMAIN`
- `VITE_REDIRECT_URI`
- `VITE_POST_LOGOUT_REDIRECT_URI`
- `VITE_API_BASE_URL`

## Useful options

- `--no-web` starts `postgres`, `adminer`, and `backend`, but not the web container. It still
  writes `web/.env.local` so Vite can run on the host.
- `--reset` deletes the local PostgreSQL volume before starting

To inspect the database, open `http://localhost:8081` and use:

- **System:** PostgreSQL
- **Server:** `postgres`
- **Username:** `crewsafe`
- **Password:** `crewsafe_local_dev`
- **Database:** `crewsafe`

## Notes

- Backend traffic goes through `http://localhost:8080`
- Web traffic goes through `http://localhost:5173`
- Adminer is available at `http://localhost:8081`
- The backend expects PostgreSQL at `postgres:5432` inside the Compose network
- The web app must use the same Cognito pool as the backend or token validation will fail
- Weather and lightning ingestion are enabled by default for the local stack. Set
  `WEATHER_DATA_MODE=fixture` to replay bundled data without calling data.gov.sg; the
  `WEATHER_INGESTION_ENABLED`, `WEATHER_FIXTURE_LOOP`, `LIGHTNING_INGESTION_ENABLED`, and
  `LIGHTNING_FIXTURE_LOOP` variables can be overridden before starting the launcher.
