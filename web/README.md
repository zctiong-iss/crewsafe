# CrewSafe web

The supervisor console. React + TypeScript + Vite, authenticating against Cognito's Hosted
UI and reading everything else from the CrewSafe API.

## Running it

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm run dev                    # http://localhost:5173
```

The dev server port is pinned to **5173** on purpose. Cognito rejects any `redirect_uri`
that is not registered on the app client, and `http://localhost:5173/callback` is what
`infra/aws/cognito-staging` registers. A different port is a failed login.

### Filling in `.env.local`

```bash
cd ../infra/aws/cognito-staging && terraform output -raw backend_env
```

Use the same pool for `VITE_COGNITO_AUTHORITY` and the **web** client id. None of these are
secrets — they travel in the address bar on every login — but they differ per environment,
so they stay out of git.

### The backend has to agree

Run it against the **same pool**, or it will reject the tokens this app obtains:

```bash
cd ../backend
SPRING_PROFILES_ACTIVE=staging \
  APP_COGNITO_ISSUER_URI=... APP_COGNITO_JWK_SET_URI=... \
  APP_COGNITO_CLIENT_IDS=... APP_COGNITO_USER_POOL_ID=... APP_COGNITO_REGION=... \
  CORS_ALLOWED_ORIGINS=http://localhost:5173 \
  ./mvnw spring-boot:run
```

**Local development cannot use `cognito-local`.** The emulator implements the Cognito
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
