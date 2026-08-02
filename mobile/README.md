# CrewSafe Mobile

The React Native app for WBGT CrewSafe SG — the worker-facing half of the platform, plus the
supervisor shift-planning surface. Expo SDK 57, TypeScript, runs in Expo Go.

Built against Sprint 1: **SCRUM-172** (lightning stop-work banner), **SCRUM-186** (approved
action inbox with idempotent acknowledgement) and **SCRUM-161** (create-shift form, shift
list and detail).

---

## Quick start

No configuration needed. The app defaults to `mock` auth mode, which serves its own
fixtures and never touches the network — so it runs with no backend, no AWS account and no
`.env`.

```bash
cd mobile
npm install
npm start
```

Scan the QR code with **Expo Go** on Android or iOS. Sign in as any of the three demo users
and you land in the tab set for that role.

> **Your phone and your computer must be on the same Wi-Fi network.** That is the only
> requirement for the mock path.

### On an Android emulator

```bash
npm run android
```

Starts Metro and opens the app on whichever emulator `adb` can see. What you need first:

- **Android Studio** with at least one AVD created, and that emulator **already running**
  (`adb devices` should list it). Any recent Play-image device works.
- **`ANDROID_HOME`** pointing at your SDK, and `platform-tools` on `PATH` so `adb` resolves.
  Android Studio sets both on a standard install.

Expo Go is installed onto the emulator automatically if it is missing. If it is present but
**older than the project's SDK**, Expo replaces it — an Expo Go built for SDK 54 cannot run
an SDK 57 project, and the reinstall is a one-off per emulator image.

The emulator reaches Metro through `adb reverse`, which Expo sets up itself. Note that its
address for your machine is **`10.0.2.2`**, not `localhost` — see
[the backend section](#setup) if you point the app at a real API.

### Why Metro runs on port 8082

The `start`, `android` and `ios` scripts all pass `--port 8082`. Metro's default, 8081, is a
crowded port — Apache ships on it in several bundles (XAMPP, and the `httpd` inside EDB
Postgres Enterprise Manager) — and Metro loses that contest *silently*: it binds `[::]` in
dual-stack mode, so a rival bound to `0.0.0.0:8081` takes IPv4 while Metro keeps IPv6. The
device then talks to the wrong server and reports **"Failed to download remote update"**,
which points at nothing useful.

`web:pkce` deliberately stays on 5173, which is a registered Cognito callback.

### Verifying the build

```bash
npm run typecheck     # tsc --noEmit
npm run doctor        # expo-doctor — 20/20 at time of writing
```

---

## Running against the real backend

Three sign-in modes, chosen with `EXPO_PUBLIC_AUTH_MODE`. They exist because **Expo Go
cannot complete the production login flow**, and pretending otherwise would have meant a
demo that only works on a machine nobody has built yet.

| Mode | Where it runs | Token | What it needs |
|---|---|---|---|
| `mock` *(default)* | Expo Go, on a phone | Fake | Nothing |
| `cognito-password` | **Expo Go, on a phone** | **Real Cognito** | Config below + demo passwords |
| `cognito-pkce` | Expo **web** (`npm run web:pkce`) | Real Cognito | Config below |

### Why there are three

The Cognito mobile app client's callback is pinned by Terraform validation to exactly
`crewsafe://callback` ([`infra/terraform/cognito/variables.tf`](../infra/terraform/cognito/variables.tf)).
Expo Go is one app with one bundle id — it registers `exp://` and cannot claim a custom
scheme, which is declared in a native manifest at build time. So the Hosted UI flow cannot
complete inside Expo Go at all, on any amount of client-side effort.

- **`cognito-password`** uses the already-provisioned `crewsafe-cli-integration` client,
  the only one with `ALLOW_USER_PASSWORD_AUTH`. It is a single unsigned HTTPS POST to
  `InitiateAuth` — no browser, no redirect URI, no AWS SDK — so it works on a phone.
- **`cognito-pkce`** is the production-shaped flow. It runs today under
  `npm run web:pkce`, because port 5173 is already a registered callback on the *web*
  client and already an allowed CORS origin. On a phone it needs a development build.

### Setup

```bash
cp .env.example .env
```

Fill in `EXPO_PUBLIC_API_BASE_URL`. **`localhost` will not work from a physical phone** —
the phone resolves that to itself:

```
physical device   http://192.168.x.x:8080   ← your machine's LAN IP (`ipconfig` / `ifconfig`)
Android emulator  http://10.0.2.2:8080
iOS simulator     http://localhost:8080
```

For either Cognito mode, read the non-secret ids off the same shared config `run.sh` uses:

```bash
gh variable get CREWSAFE_SHARED_COGNITO_JSON --json value --jq .value \
  | jq '.accounts.dev | {region, issuer_uri, hosted_ui_url, web_client_id, cli_client_id}'
```

Start the backend from the repository root with `./run.sh`, and get the synthetic users'
passwords from AWS Secrets Manager (see the [root README](../README.md#cognito)).

### One change outside `mobile/`

`run.sh` now includes `cli_client_id` in `APP_COGNITO_CLIENT_IDS`:

```bash
export APP_COGNITO_CLIENT_IDS="$(jq -r '[.web_client_id,.mobile_client_id,.cli_client_id] | join(",")' <<<"$ACCOUNT")"
```

Without it the backend rejects tokens from the CLI client and `cognito-password` cannot
work. This is not new policy — staging already allows all three identically, at
[`infra/terraform/secrets/main.tf:65`](../infra/terraform/secrets/main.tf). It is a
launcher script, not Spring code, and it is one reversible line.

### Safety rails on the dev-only modes

`mock` and `cognito-password` **throw outside `__DEV__`**, enforced at the point of use
rather than only by hiding the selector — a hidden control is not an access control.
`cognito-password` puts a raw password in the app, which is exactly what Hosted UI + PKCE
exists to avoid ([ADR 0002](../docs/adr/0002-cookie-free-bearer-authentication.md),
[ADR 0004](../docs/adr/0004-aws-cognito-for-authentication.md)); it is tolerable only
because it is fenced to development and to synthetic accounts. The password lives in form
state that dies with the screen — never Redux, never persisted, never logged.

---

## What was built

| Screen | Story | Against |
|---|---|---|
| Sign in | — | Three auth modes, dev-only selector |
| Request an account | — | **Placeholder by necessity** — see gaps below |
| My shift | **SCRUM-172** | Mocked |
| Inbox | **SCRUM-186** | **Real** `ActionDispatchController` |
| Weather | — | Mocked conditions, **real** `GET /sites` |
| Shifts / detail | **SCRUM-161** | **Real** `ShiftController` |
| Create shift | **SCRUM-161** | **Real** `ShiftController` |
| Settings | — | Local |
| Profile | — | **Real** `GET /me`; avatar is local-only |

Navigation is **role-aware**: `WORKER` gets *My shift · Inbox · Weather · Profile*;
`SUPERVISOR` / `SAFETY_MANAGER` / `ADMIN` get *Shifts · Weather · Profile*. The role test is
an allow-list, so an unrecognised role falls back to the least-privileged tabs rather than
the most.

### Acceptance criteria, and how to see them

**SCRUM-172 — "the warning clears on expiry."** My shift → the stop-work banner counts down
per second and flips to a muted expired state at the boundary. The heat plan's *Suspended*
notice disappears at the same instant. The mocked window is 90 seconds rather than §7.1's
~30 minutes, because nobody watches a screen for half an hour to confirm a banner clears —
that duration is the only value shortened.

The expired state deliberately **does not say "safe to resume"**. What lapses at
`validUntil` is the server's assessment, not the hazard; §7.1 holds a stop-work until a
supervisor-confirmed all-clear, so the banner names who decides.

**SCRUM-186 — "killing the network mid-acknowledgement and retrying produces exactly one
acknowledgement."** Inbox → dev panel → *Simulate a lost response*. The server commits, the
reply is dropped, the card shows a failure and *"Tapping again is safe."* Retry as often as
you like: the counter, read from the mock server's own ledger, stays at **1**.

**SCRUM-161 — "a supervisor creates a shift end to end; validation errors per field."**
Shifts → Plan a shift. Also: dev panel → *Simulate a cross-site 403*, which is otherwise
unreachable because the picker only offers sites you belong to.

---

## Project structure

```
src/
├─ api/           client (axios + bearer + X-Request-Id) · errors · tokenStore
│  ├─ endpoints/  one module per backend surface; mock/real chosen inside
│  └─ mock/       fixtures for what the backend does not expose yet
├─ auth/          three sign-in modes behind one `performSignIn`
├─ components/    buttons · inputs · texts · views · feedback · safety · shifts · sheets
├─ constants/     config (env) · siteCodes
├─ helpers/       dateTime · weather · avatarStorage
├─ hooks/         useNow · useAutoRefresh · useReduceMotion
├─ localization/  i18n · LanguageSync · en / zh-Hans / hi
├─ navigation/    RootNavigator · AuthStack · WorkerTabs · SupervisorTabs · stacks
├─ screens/       auth · worker · supervisor · weather · settings · profile
├─ store/         store · hooks · persistConfig · 8 slices
├─ styles/        colors (2 palettes) · fonts · theme · sharedStyles
└─ types/         domain — mirrors the Java records and OpenAPI schemas
```

---

## Backend gaps

**This is the most important section of this file.** Every gap is annotated at the code that
works around it, with the response shape it needs. Nothing below is a TODO in the vague
sense — each names what to build.

| Needed | Status | Annotated in |
|---|---|---|
| `GET /sites/{id}/lightning` | **Nothing exists.** No ingestion, no classifier, no endpoint. SCRUM-170 unstarted | `api/mock/lightning.ts` |
| `GET /sites/{id}/conditions` | Table + NEA ingestion **exist**; no controller exposes them | `api/mock/conditions.ts` |
| `GET /api/v1/shifts/me` | Contract fully written in `shift-readiness.yaml`; no controller | `api/mock/myShift.ts` |
| Self-service sign-up | **Switched off at the identity provider** | `screens/auth/SignUpScreen.tsx` |
| Unauthenticated site list | No endpoint; a signed-out user cannot name their site | `constants/siteCodes.ts` |
| Avatar storage | No field on `MeResponse`, nothing accepts an upload | `store/reducers/profileSlice.ts` |
| `Idempotency-Key` consumption | Header sent and CORS-allowed; not read | `api/endpoints/dispatch.ts` |
| Per-field validation detail | Deliberately generic — see below | `screens/supervisor/CreateShiftScreen.tsx` |

### Three that need more than an endpoint

**Sign-up cannot work, at two independent layers.** The Cognito pool sets
`allow_admin_create_user_only = true`, so self-service registration is off at the identity
provider. Even past that, the `app_user` row that actually grants role and site access is
provisioned by `DemoDataSeeder` from a reviewed repository variable — no API writes one. So
the screen validates properly and hands the user something to send to an administrator. It
never claims to have submitted anything, and it has **no role selector**, so it cannot
become a privilege-escalation path if a submit endpoint is bolted on later.

**Per-field validation errors are impossible to get from the server.**
`GlobalExceptionHandler` maps every `MethodArgumentNotValidException` to
`{"message":"Invalid request parameters"}` with no field detail — deliberately, since its
stated rule is that no exception message reaches the caller. SCRUM-161's *"per field, not a
generic failure"* is therefore only achievable by making a server 400 **unreachable**: every
client rule mirrors one in `shift.yaml` or `ShiftService`, including that `endsAt` must be
*strictly* after `startsAt` (`isAfter` is strict, so equal timestamps are a 400).

**The idempotency key is forward-looking, and that is the point.** The acceptance criterion
already holds without it: `acknowledgeDispatch` returns early when already `ACKNOWLEDGED`,
*before* `auditService.record`, so a replay produces neither a second state change nor a
second audit event. The key exists for **SCRUM-130** — an offline queue replays writes long
after the fact, possibly across a reinstall, where state-based idempotency no longer helps.
A key minted and persisted at the moment of the tap is what makes that replay safe, and it
cannot be retrofitted onto items already queued.

### Two things the server does not validate

Neither is a contract rule; the UI shape prevents them instead, and a redesign could
reintroduce both:

- **The same worker twice on one shift.** `createShift` saves each assignment with no
  uniqueness check. Impossible here because the crew is a multi-select with one row per
  worker, not a repeatable "add worker" list.
- **A worker from another site.** Also unchecked. The picker is populated from
  `GET /sites/{id}/workers`, so there is nothing else to choose.

---

## Decisions worth knowing

**Tokens are in SecureStore, never AsyncStorage.** redux-persist's allowlist is
`["preferences", "profile"]` only. AsyncStorage is unencrypted plaintext; a bearer token
there outlives the session and is readable on a rooted device. The web console reasons the
same way in [ADR 0005](../docs/adr/0005-browser-token-storage.md).

**`auth` is never persisted.** Role and site membership are revocable server-side, so
identity is re-fetched from `GET /api/v1/me` on every launch. A cached copy could keep
showing a revoked supervisor their tools.

**401 signs you out; 403 never does.** 401 means the *session* is bad. 403 means the session
is fine and this *user* may not do this one thing — signing them out would lose their work
and teach them nothing. The one exception is `GET /me` during session resolution, where a
401 means "no CrewSafe row" and tearing down would discard the token the retry needs.

**Safety policy is never computed in the app.** FR-15 makes the backend engine
authoritative and §12.2 forbids a client deciding a risk band. The rule matrix that produces
WBGT bands lives in `api/mock/conditions.ts` — part of the *mock server*, not a helper the
UI can import. Delete that file when the endpoint lands; delete nothing else.

Weather *condition* classification (`helpers/weather.ts`) **is** client-side, and the
distinction is real: it picks an icon, nothing acts on it, and the backend has no forecast
string to give — the NEA ingestion stores metrics only.

**Everything auto-refreshes, on intervals tied to the plan.** Inbox 30s (the NFR is 60s
visibility), shift 60s (it carries the lightning state), weather 5min (ingestion writes
every 15). Polling is focus- and foreground-aware, so a screen nobody is looking at costs
no battery; a background poll that already has data changes nothing visible, so a spinner
never covers a stop-work banner someone is reading.

**Preferences survive sign-out; user data does not.** Accessibility settings belong to the
device — nobody should re-set high contrast every shift. Everything user-scoped resets. The
profile photo is keyed by user id precisely so a shared phone never shows the previous
worker's face above the next worker's name.

---

## Accessibility

Not decoration — these are the operating conditions: a phone at arm's length in Singapore
sun, held by someone who may not read English, possibly in gloves.

- **Three languages** (English, 简体中文, हिन्दी), each listed in its own script. The picker
  is reachable **from the sign-in screen**, not only from Settings — otherwise a shared
  phone left in a language you cannot read is a trap with no way out.
- **Text size** 0.85–1.5×, applied by `AppText` on top of device scaling. No raw `<Text>`
  exists anywhere in `src/`, so nothing opts out. Capped at 1.5 because fixed-height
  controls clip their own labels past that.
- **High contrast** collapses greys to pure black and doubles border widths. Every colour
  clears WCAG AA against its background.
- **Reduce motion** honours the OS setting *or* an in-app toggle, and stops screen
  transitions as well as icon animation. WCAG 2.2 SC 2.2.2 requires looping animation to be
  stoppable.

Every error message is a translation key, never a hardcoded string — including the ones
derived from HTTP status.

---

## Deliberate deviations from the brief

| Asked for | Used instead | Why |
|---|---|---|
| `react-native-image-picker` | `expo-image-picker` | The former does not work in Expo Go |
| Lottie weather/banner icons | Ionicons + `Animated` | Hand-authored Lottie per state is unverifiable in review and would not match the app's other icons. `WeatherIcon` documents the swap; `AppLoader` still uses Lottie |
| "react-safe-area" | `react-native-size-matters` + `react-native-safe-area-context` | Scaling and insets are two different libraries |
| Committed Gelasio `.ttf` | `@expo-google-fonts/gelasio` | Same binaries, out of git, family names as constants |
| EAS APK build | *(dropped at your request)* | Testing in Expo Go |

---

## Known limitations

- **Verified to launch, not verified visually.** The app bundles and runs in Expo Go on an
  Android emulator (SDK 57, Android 15). Beyond that, verification is `tsc`, both platform
  bundles, `expo-doctor`, and executable specs for the logic — idempotency, validation
  boundaries, weather classification, persistence migration, race guards. What remains
  unchecked is judgement, not correctness: Gelasio's rendering at large text sizes, whether
  the stop-work banner actually reads in direct sun, and whether the animation rates feel
  right. iOS has never been run at all.
- **Offline queueing is out of scope** (SCRUM-130). The idempotency key is the groundwork.
- **Reactotron is not wired.** It needs host configuration to reach a phone; nothing in the
  app depends on it.
- **Acknowledgement records accumulate** for the life of the install. Pruning belongs with
  SCRUM-130, which already has to reason about queue lifetime.
- **`cognito-pkce` on a phone needs a development build.** It is written and inert until
  then; `npm run web:pkce` exercises it today.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| *"Failed to download remote update"* in Expo Go | Something else owns Metro's port. The scripts use 8082 for this reason; if 8082 is also taken, pass another `--port`. `Get-NetTCPConnection -LocalPort 8082 -State Listen` names the owner on Windows |
| Expo Go opens then immediately errors on the emulator | Expo Go is older than the project's SDK. Expo reinstalls it automatically — let it finish and it will not recur on that image |
| `npm run android` says no devices | The emulator is not running yet. Start it from Android Studio's Device Manager first; `adb devices` must list it |
| Network error in a Cognito mode | `EXPO_PUBLIC_API_BASE_URL` is `localhost`. Use your LAN IP |
| *"Account not set up"* right after a correct password | Cognito accepted you but there is no `app_user` row. The account needs provisioning |
| *"This account still has its temporary password"* | Every account starts admin-created. Set a permanent password in the AWS Console first |
| `redirect_mismatch` from Cognito | `cognito-pkce` on a phone. Use `npm run web:pkce`, or a dev build |
| Sign-in works but every request 401s | Backend and app on different Cognito accounts. Re-run `./run.sh --account <alias>` |

### About the npm `override`

`react-native-actions-sheet@10` depends on `react-native-worklets ^0.7.1`, while SDK 57's
Reanimated needs 0.10.x. A caret on a `0.x` version does not span minors, so npm installs a
**second nested copy** — two copies of a native module, which breaks native builds in a way
that is painful to diagnose. The `overrides` block pins it to the root version using
`$react-native-worklets`, so it cannot drift on upgrade.
