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

### Running Metro

`--port 8082` is already in the scripts, so no flag is needed — plain `npm start` is enough.
[Why 8082](#why-metro-runs-on-port-8082) matters more than it looks.

| Command | Does |
|---|---|
| `npm start` | Metro on 8082. Then press **`a`** for Android, or scan the QR with Expo Go |
| `npm run android` | Metro on 8082 **and** launches the emulator, in one step |
| `npm run ios` | Same, for an iOS simulator (macOS only) |

Once Metro is running, in that terminal:

| Key | |
|---|---|
| `a` | Open on Android |
| `r` | Reload the app |
| `j` | Open the debugger |
| `Ctrl+C` | Stop Metro |

`Ctrl+M` inside the emulator window opens the React Native dev menu.

**If Metro says the port is in use**, something else took 8082. Name the owner:

```powershell
Get-NetTCPConnection -LocalPort 8082 -State Listen |
  ForEach-Object { Get-Process -Id $_.OwningProcess }
```

Metro will also simply offer the next free port, and accepting that is fine — it only
changes the URL the device connects to, and Expo rewrites the QR code to match.

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
| `react-native-actions-sheet` | React Native `Modal` | **Removed after it crashed the app** — see [Problem 2](#problem-2--expo-go-keeps-stopping). Its latest release targets worklets 0.7 while SDK 57 ships 0.10; no configuration reconciles that |
| EAS APK build | *(dropped at your request)* | Testing in Expo Go |

---

## Known limitations

- **Exercised on an Android emulator; never on iOS.** The worker screens have been driven on
  a Pixel 9 / API 35 emulator — sign-in, the stop-work banner, the inbox, and a successful
  one-tap acknowledgement. Six bugs found that way are written up above. Beyond that,
  verification is `tsc`, both platform bundles, `expo-doctor`, and executable specs for the
  logic. **iOS has never been run at all**, and the supervisor screens have not been driven
  end to end on a device.
- **Still unverified by eye:** Gelasio at the largest text setting, whether the stop-work
  banner reads in direct sun, and whether the animation rates feel right rather than merely
  work.
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

---

## Problems found on the emulator, and how they were diagnosed

Six bugs were found by running the app on an Android emulator (Pixel 9, API 35) that
**nothing in the static checks could catch** — `tsc` passed, both platform bundles built,
`expo-doctor` reported 20/20, and every executable spec passed the whole time. Two were
JS↔native problems that only exist at runtime; one was an environment collision; three were
layout bugs that only appear once real text is measured on a real screen.

The layout ones share a root cause worth naming: **a style can be type-correct and still be
wrong**, and nothing in the toolchain measures pixels. Every one of them came back to a
container guessing a child's height or width instead of being told it.

They are written up in full because the *technique* transfers, and because each one looked
like something it wasn't.

---

### Problem 1 — "Failed to download remote update"

**Symptom.** Scanning the QR code in Expo Go fails immediately. No JS ever runs, so there is
nothing in the Metro log and no red screen.

**Looked like** a network or firewall problem. It was neither.

**How it was diagnosed.**

```powershell
Get-NetConnectionProfile                  # Private, so Windows was not blocking inbound
Get-NetTCPConnection -LocalPort 8081 -State Listen
#   0.0.0.0    8081   PID 5300  httpd     ← Apache holds IPv4
#   ::         8081   PID 32180 node      ← Metro holds IPv6
```

**Root cause.** Metro binds `[::]` in **dual-stack** mode, which normally serves IPv4 too.
But a rival bound to the *specific* address `0.0.0.0:8081` wins the IPv4 route. The
offender here was `PEMHTTPD-x64` — the Apache bundled with **EDB Postgres Enterprise
Manager**, `StartMode: Auto`, so it reclaims the port on every boot. The device speaks IPv4,
reached Apache, and got something that was not an Expo manifest.

Nothing errors in this scenario, which is what makes it expensive: both servers are running
correctly, just not the one you are talking to.

**Fix.** Metro moved to **8082** in the `start`, `android` and `ios` scripts. Freeing 8081
instead would need an elevated `Stop-Service PEMHTTPD-x64` plus `Set-Service … -StartupType
Manual`, and would have to be repeated on every machine with a service on that port.

---

### Problem 2 — "Expo Go keeps stopping"

**Symptom.** The app bundles successfully, then Expo Go dies before rendering anything.
Android shows its own *"Expo Go keeps stopping"* dialog — an app-level crash, not a JS error.

**Looked like** the app's own code. It was a dependency.

**How it was diagnosed.** A JS error appears in Metro; a *native* crash does not, so read
Android's dedicated crash buffer instead:

```powershell
adb logcat -b crash -d
```

```
signal 11 (SIGSEGV), thread: mqt_v_js        ← the JS thread
  #02  libhermesvm.so
  #08  libworklets.so                        ← the culprit
  #09  libhermesvm.so
```

That names the library. To confirm it was *loading* that package rather than anything the
app did with it, the package was made unresolvable and the app relaunched — the segfault
became an ordinary red-screen resolution error, which is proof.

> An earlier attempt removed `SheetProvider` from `App.tsx` and the crash persisted, which
> looked exonerating but was not: three screens still imported `SheetManager`, so the module
> still loaded. **Removing a provider is not the same as removing an import.**

**Root cause.** `react-native-actions-sheet@10.1.2` — the latest release — declares
`react-native-worklets: ^0.7.1`, while Expo SDK 57 ships worklets **0.10** natively. Inside
Expo Go the native `libworklets.so` is fixed at whatever Expo Go was built with, so the
library's JS called an ABI it was not written against.

**This was not fixable by configuration.** An npm `overrides` block pinning worklets to
0.10 is what the project had, and pinning it back to 0.7 only moves which side is wrong —
the native half is not ours to change.

**Fix.** Removed `react-native-actions-sheet` and replaced both sheets with React Native's
built-in `Modal` (`components/sheets/BottomSheet.tsx`). That also removed
`react-native-reanimated` and `react-native-worklets`, which were in the tree *only* to
satisfy it — every animation in this app uses the built-in `Animated` API — along with the
`overrides` block that existed solely to referee the conflict.

---

### Problem 3 — Acknowledging always failed on the first tap

**Symptom.** Tapping **Acknowledge** always showed *"Something went wrong. Try again."*
A second tap succeeded. Reproducible on every card, every time.

**Looked like** a network or idempotency bug. It was neither.

**How it was diagnosed.** The message was the clue: *"Something went wrong"* is
`errors.unknown`, not `errors.network`. That rules out the lost-response simulator
immediately and says something is throwing a **non-`ApiError`** — before reading any code.

The only thing that differs between the first and second attempt is that the idempotency key
is minted on the first and reused on the second, which pointed straight at the write path.

**Root cause.** The mock returned the **same object references** it held in its own store:

```ts
return [...dispatches.values()].filter(...)   // same refs, not copies
```

Those objects reach Redux, where **Immer deep-freezes state in development**. The mock's own
store silently became read-only, so the next write —

```ts
dispatch.status = "ACKNOWLEDGED";
```

— threw `TypeError` (ES modules are strict mode). Not an `ApiError`, hence the generic
message. The *second* tap "worked" because the ledger entry is written **before** the throw,
so the retry took the replay branch and returned without writing.

**The dangerous half.** On that second tap the row was still `PENDING`. The client recorded
an acknowledgement the server never made, and the idempotency counter still read `1`, so the
demo looked correct. That is the part that would have survived into a real backend
integration unnoticed.

**Fix.** Two independent changes, either of which alone would have prevented it:

1. Mock reads return **copies** — a real HTTP client deserializes a fresh object per
   response, so nothing the server holds is ever reachable by the caller.
2. Mock writes **replace** rather than mutate (`store.set(id, {...existing, ...changes})`),
   so an escaped reference cannot poison the store.

The same treatment was applied to `api/mock/shifts.ts`, which had the identical latent
hazard and had simply not been hit yet.

---

### Problem 4 — Status text overlapping the Acknowledge button

**Symptom.** On the inbox card, *"Awaiting your acknowledgement"* wrapped to a second line
that rendered **underneath** the Acknowledge button.

**How it was diagnosed.** Visible in a device screenshot; it does not reproduce in a type
check or a bundle, because it only exists once real text is measured at a real width.

**Root cause.** The meta row used `flexWrap` and relied on the row measuring the height of a
child whose *own* text wrapped internally. On Android that came out one line short, so the
second line rendered outside the row's measured box and the next sibling drew over it.

**Fix.** Replaced the wrapping row with two explicit columns — a fixed-width timestamp
(`flexShrink: 0`) and a status column (`flex: 1`) with a real width to wrap inside — plus
`alignItems: "flex-start"` so both labels sit on the same horizontal axis, and margin on
both sides of the gap rather than one.

---

### Problem 5 — Title and icon out of line on an untranslated action code

**Symptom.** On the inbox card, `ROTATE_TO_LIGHT_DUTY` wrapped to two lines, the icon sat in
the gap between them, and the second line was a single orphaned `Y`. Cards whose code *is*
translated ("Drink water now") looked fine.

**Two separate causes, and the first fix only addressed one of them.** Worth recording,
because the first attempt looked plausible and did not fix what was actually being
complained about.

**Cause A — the icon.** `headerRow` used `alignItems: "center"`, which centres the icon
against the *whole* title block. One line looked right; two lines dropped the icon into the
gap. Fixed by top-aligning and nudging down by half the difference between the line box and
the icon, putting it on the first line's optical centre.

That offset is **derived, not hardcoded**:

```ts
const iconTopOffset = (lineHeightFor("subtitle", theme.fontScale) - iconSize) / 2;
```

`lineHeightFor` is exported from `AppText` so the calculation uses the same numbers the text
itself does. A literal `marginTop: 3` would look correct on one device and drift silently on
a 320dp phone or at 1.5× text — and nothing type-checks a visual offset.

**Cause B — the real one.** `ROTATE_TO_LIGHT_DUTY` contains no spaces, so there is nowhere
to wrap: Android breaks it mid-word. Untranslated codes are now humanised
(`helpers/actionCodes.ts`) to `Rotate to light duty`, which is shorter, usually fits on one
line, and has real word boundaries when it does not. Applied to both fallbacks —
`DispatchCard` and `HeatGuidance`.

This path exists because `action_code` is deliberately not CHECK-constrained server-side, so
the catalogue can grow ahead of this app's translations. The fallback is expected to be hit.

---

### Problem 6 — Profile rows wrapped to two lines

**Symptom.** `synthetic-worker@synthetic.crewsafe.invalid` wrapped under the "Username"
label, so the label and its value stopped reading as a pair and that row was visibly taller
than "Role" and "Sites".

**Root cause.** The value was `flexShrink: 1` with no line limit, so it wrapped instead of
truncating — and row height therefore varied with the length of whatever the server returned.

**Fix.** `numberOfLines={1}` with `ellipsizeMode="middle"`, label `flexShrink: 0`, value
`flex: 1`. Every row is now exactly one line on any screen at any text scale.

`middle` rather than `tail` because these values are identifiers: the informative parts of
`synthetic-worker@synthetic.crewsafe.invalid` are the name at the front and the domain at
the end, and tail truncation would eat the domain entirely. The trade-off is real — a long
username is no longer readable in full, and if that matters the row should become a
label-above-value stack rather than reverting to wrapping.

> `ellipsizeMode="middle"` is one of the props where iOS and Android differ most in
> rendering. **iOS has never been run**, so this row is worth checking first on a simulator.

---

### What this says about the checks

Static verification caught none of these. It is good at contracts and shapes and useless at
ABI compatibility, port ownership, framework freezing behaviour, and text measurement. The
lesson worth keeping: **get it onto a device before believing it works**, and when something
native fails, read `adb logcat -b crash -d` rather than reasoning about the JS.
