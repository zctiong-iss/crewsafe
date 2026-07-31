# CrewSafe

CrewSafe is a local-development stack for the WBGT CrewSafe SG project.

## Start the local stack

From the repository root, start the full local stack with a shared Cognito account alias:

```bash
./run.sh
```

Use Docker instead of Podman with:

```bash
./run-docker.sh
```

The default alias is `dev`. Override it with `--account <alias>` when needed.

The stack starts:

- PostgreSQL on `http://localhost:5434`
- Backend on `http://localhost:8080`
- Web app on `http://localhost:5173`

## Before you start

- Run `gh auth status`
- Make sure `CREWSAFE_SHARED_COGNITO_JSON` is available in GitHub repository variables
- Use an account alias that exists in that shared Cognito config

Normal local development uses the shared remote Cognito pool. There is no local Cognito emulator in the runtime stack.

## Options

- `--no-web` starts only PostgreSQL and the backend
- `--reset` deletes the local PostgreSQL volume before starting

## More details

See [local/README.md](local/README.md) for the Compose stack layout and environment details.
