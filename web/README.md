# CrewSafe web

The supervisor console. React + TypeScript + Vite, authenticating against Cognito's Hosted
UI and reading everything else from the CrewSafe API.

## Running it

Two ways, and they are not interchangeable. **Path A is the normal one** — reach for Path B
only when you are editing `web/` and want hot reload.

|                       | Path A — all in containers      | Path B — Vite on your machine    |
| --------------------- | ------------------------------- | -------------------------------- |
| Steps                 | one command                     | two, in order                    |
| What runs             | postgres, backend, adminer, web | web on your host; backend from A |
| `npm install` locally | no — the container runs it      | yes                              |

### Which launcher

Both paths start from the repository root, and the choice of script is **your container
engine**, nothing else:

```bash
./run.sh --account <alias>          # Podman
./run-docker.sh --account <alias>   # Docker — the same script with
                                    # CREWSAFE_CONTAINER_ENGINE=docker
```

`--account` defaults to `dev`. Stay with one engine: each only sees its own containers, so
following up a `run.sh` stack with `docker compose` finds nothing. Logs and shutdown commands
are in the [root README](../README.md#logs-and-shutdown).

### Path A — containers

```bash
./run.sh --account dev          # Docker users: ./run-docker.sh --account dev
```

That is all of it. Web on `http://localhost:5173`, API on `:8080`, adminer on `:8081`,
PostgreSQL on `:5434`. Nothing is installed on your machine.

### Path B — Vite on your machine

`--no-web` brings up everything except the web container, leaving port 5173 free for you —
and it still writes `web/.env.local`, which is the configuration your dev server needs:

```bash
# 1 — database, backend and adminer up; 5173 left free; web/.env.local written
./run.sh --account dev --no-web        # Docker: ./run-docker.sh --account dev --no-web

# 2 — your own dev server
cd web
npm install
npm run dev                    # http://localhost:5173
```

Do not start Path A first and then try this — the web container will already hold 5173.
If you have one running, stop it with `podman compose -f local/compose.yaml stop web`
(or `docker compose`, matching the engine you launched with).

The dev server port is pinned to **5173** on purpose. Cognito rejects any `redirect_uri`
that is not registered on the app client, and `http://localhost:5173/callback` is what
`infra/terraform/cognito` registers. A different port is a failed login. `vite.config.ts`
sets `strictPort: true` so that this fails loudly at startup rather than quietly on the
redirect — if something else holds 5173, `npm run dev` exits instead of sliding to 5174.

### What is in `.env.local`

`run.sh` writes it from the validated `CREWSAFE_SHARED_COGNITO_JSON` repository variable and
**rewrites it on every run** — so switch pools by re-running with a different `--account`,
not by editing the file. `.env.example` documents each key.

Use the same pool for `VITE_COGNITO_AUTHORITY` and the **web** client id. None of these are
secrets — they travel in the address bar on every login — but they differ per environment,
so they stay out of git.

Vite substitutes these values into the bundle at transform time rather than reading them at
runtime, so an edit to `.env.local` needs a dev-server restart before it takes effect.

### The backend has to agree

Neither path above needs this — `run.sh` configures both sides from one source, which is the
point of it. This is for the case where you run the backend yourself, against a pool the
launcher does not know about.

Run it against the **same pool** as this app, or it will reject the tokens this app obtains.
It needs **JDK 21** on your host (`backend/pom.xml` targets release 21; a JDK 17 `JAVA_HOME`
fails with `release version 21 not supported`):

```bash
cd ../backend
SPRING_PROFILES_ACTIVE=staging \
  APP_COGNITO_ISSUER_URI=... APP_COGNITO_JWK_SET_URI=... \
  APP_COGNITO_CLIENT_IDS=... APP_COGNITO_USER_POOL_ID=... APP_COGNITO_REGION=... \
  CORS_ALLOWED_ORIGINS=http://localhost:5173 \
  ./mvnw spring-boot:run
```

**Normal development does not use `cognito-local`.** The emulator implements the Cognito
Identity Provider API but has no Hosted UI, so there is no `/oauth2/authorize` to redirect
to. `cognito-local` remains what the backend's tests run against; the web app needs a real
pool.

## Layout

```
src/
├── api/          typed client, error taxonomy, endpoint wrappers
├── app/          routing, navigation model
├── auth/         provider, callback, the pre-app screens
├── components/   shell, wordmark, empty state
├── design/       tokens.css — every colour and size in the app
├── features/     one folder per feature; add here as things land
└── test/         setup and fakes
```

Feature-first, not type-first: a feature is added by creating one folder, not by touching
five shared ones.

## Things worth knowing before changing them

**`design/tokens.css` is the only place with raw colour values.** In a safety interface a
colour usually means something, and the two hazard scales are deliberately separate:
`--band-*` is the WBGT risk band (what the environment is doing, rendered filled) and
`--intensity-*` is work intensity (what the crew is doing, rendered outlined). They share a
hue family; conflating them would let "hard work" read as "dangerous conditions".

**401 and 403 are not the same thing.** 401 means the session is bad — sign out. 403 means
this user may not do this — stay signed in and explain. Treating them alike logs people out
on permission errors. Enforced in `api/errors.ts` and asserted in `api/client.test.ts`.

**The "account not set up" screen is an inference, not a server response.** The API answers
401 identically for every cause on purpose, so it cannot tell the client that the Cognito
account has no `app_user` row. The client works it out: it holds a valid, unexpired token,
so the token is not the problem. That reasoning lives in `AuthProvider`.

**Tokens go in `sessionStorage`.** See [ADR 0005](../docs/adr/0005-browser-token-storage.md).
There is a test that fails if this changes.

**Navigation is presentation, not security.** `app/navigation.ts` hides sections a role has
no use for. Every destination is enforced server-side, because a hidden link is still a
typeable URL.

## Tests

```bash
npm test          # vitest
npm run typecheck
```

They cover the decisions above rather than chasing coverage: which screen each auth state
produces, the 401/403 split, that returning from Cognito actually signs you in, and that
tokens never reach `localStorage`.
