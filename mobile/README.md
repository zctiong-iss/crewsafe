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
| My shift | **SCRUM-172**, **196/197** | Mocked |
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
per second and flips to a muted expired state at the boundary. The mocked window is 90
seconds rather than §7.1's ~30 minutes, because nobody watches a screen for half an hour to
confirm a banner clears — that duration is the only value shortened.

> The heat plan's *Suspended* notice used to disappear at the same instant. That card is now
> hidden — see [SCRUM-196/197](#scrum-196--197--my-shift-screen-reorder-and-strip) — and
> `WbgtCard`'s own *Superseded by the lightning stop-work* label is what carries the
> override while it is off.

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

- **Seven languages** (English, 简体中文, हिन्दी, Bahasa Melayu, தமிழ், বাংলা, မြန်မာ), each
  listed in its own script. The picker is reachable **from the sign-in screen**, not only from
  Settings — otherwise a shared phone left in a language you cannot read is a trap with no way
  out. See [SCRUM-205](#scrum-205--localisation) below.
- **Text size** 0.85–1.5×, applied by `AppText` on top of device scaling. No raw `<Text>`
  exists anywhere in `src/`, so nothing opts out. Capped at 1.5 because fixed-height
  controls clip their own labels past that.
- **High contrast** collapses greys to pure black and doubles border widths. Every colour
  clears WCAG AA against its background.
- **Reduce motion** honours the OS setting *or* an in-app toggle, and stops screen
  transitions as well as icon animation. WCAG 2.2 SC 2.2.2 requires looping animation to be
  stoppable. **On by default, and scoped per user account** (SCRUM-199/200) — see below.

### Reduce motion: on by default, per user (SCRUM-199 / SCRUM-200)

Three properties, and each one is a separate decision:

1. **On by default.** A worker who has never opened Settings gets motion suppressed. The
   operating condition argues for it — a pulsing glyph read at arm's length in glare is
   harder to parse than a still one, and nobody had been asked.
2. **Per user account, not per device.** `preferences.reduceMotionByUser` is keyed by user
   id, exactly as `profileSlice` keys avatars. A new worker signing in on a shared site
   phone gets the default, not the previous worker's answer.
3. **Persisted both ways.** Turning it *off* is recorded as deliberately as turning it on,
   so it survives sign-out, backgrounding, and cold start.

**Language, text size and high contrast are deliberately still per-device.** Those answer a
question about the phone and the light it is being read in — a site handset that needs high
contrast at noon needs it for whoever is holding it, and making each worker set it again
every morning is a cost the app already refuses to pay. Reduce motion answers a question
about the *person*: vestibular sensitivity belongs to a body, not a handset.

**The stop-work pulse is exempt from the in-app toggle** — and only that one. Because the
default is now *on*, an unexempted stop-work banner would lose its urgent pulse for every
worker who never opened Settings: a safety cue removed by a default nobody chose. The
`essential` prop on `AnimatedIcon` carves out exactly that case. A device-level Reduce
Motion still stops it, because that setting was chosen by someone who has a reason, and no
in-app judgement about urgency outranks it. The advisory pulse is *not* exempt — "be ready
to stop" can afford to be still, and an exemption that covers every state is not an
exemption.

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
- **The heat plan card is switched off** (`features.heatGuidanceCard`, SCRUM-196/197). While
  it is, the app shows no mandatory heat actions, no rule references and no policy version —
  FR-15 and FR-16 have no other surface. One boolean restores it; the full reversal spec is
  in [SCRUM-196/197](#scrum-196--197--my-shift-screen-reorder-and-strip).
- **Offline queueing is out of scope** (SCRUM-130). The idempotency key is the groundwork.
- **Reactotron is not wired.** It needs host configuration to reach a phone; nothing in the
  app depends on it.
- **Acknowledgement records accumulate** for the life of the install. Pruning belongs with
  SCRUM-130, which already has to reason about queue lifetime.
- **Reduce-motion entries accumulate** likewise — one boolean per account that has ever
  signed in on the device. The same unbounded-growth caveat as the avatar map, and a great
  deal cheaper than that one. There is no server-side home for it: `MeResponse` has no
  preferences field, so the setting cannot yet follow a worker to another phone.
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

### Problem 7 — A default of `true` that would have worked only on fresh installs

**Symptom.** Not found on a device — found by reading the warning the codebase had already
written for it. SCRUM-199 flips `reduceMotion` to default on. `persistConfig.ts` had carried
this comment since the v1→v2 migration:

> *"Falsy-by-accident works until the first setting whose default is `true`. […] the first
> preference whose default is `true` would break silently on every upgraded install and work
> perfectly on every fresh one, which is the worst kind of bug to be handed."*

This ticket **is** that setting.

**Root cause.** redux-persist's default reconciler merges one level deep: each slice is
*replaced* by what was stored, not merged field by field. Every device that had ever run the
app had `reduceMotion: false` in AsyncStorage — not because anyone chose it, but because
that was the old default. On rehydrate the stored value wins, so the new default would never
reach an existing install. A reviewer testing on a clean emulator would have seen it pass.

**Fix.** Bump `PERSIST_VERSION` and write a migration that applies the new default *after*
the spread, so the stored value cannot win:

```ts
preferences: {
  ...initialPreferencesState,
  ...(previous.preferences ?? {}),
  reduceMotion: true,            // after the spread, deliberately
  reduceMotionChosenExplicitly: false,
}
```

The v2 comment is the only reason this was caught before shipping. **A migration note that
predicts a future bug is worth more than a test that cannot yet be written** — the test for
this failure needs an upgraded install, which no CI run has.

---

### Problem 8 — "Chose false" and "never asked" were the same stored value

**Symptom.** With the default flipped, a worker who deliberately switched Reduce Motion
*off* would get it silently switched back on at their next login.

**Root cause.** The state was one boolean. `false` meant both "this user turned it off" and
"nobody has been asked", and any logic that reapplies a default cannot tell those apart.

**Fix.** Record the choice, not just the value. Initially a `reduceMotionChosenExplicitly`
flag mirroring the existing `languageChosenExplicitly` pattern; after SCRUM-199 moved to
per-user scope, the *presence of an entry* in `reduceMotionByUser` carries the same
information more directly — absent means never asked, present means chosen, either way.

The half that matters is writing an entry on `false` as well as `true`. Recording only the
`true` case is the easy mistake and it fails in exactly one direction: silently, for the
users who most wanted the setting off.

---

### Problem 9 — Per-user state that renders before the user exists

**Symptom.** Moving reduce motion to per-user scope introduced a window on every cold start
where the app renders with no user resolved — and briefly with the wrong motion setting,
producing a visible flicker as animations start and then stop.

**Root cause.** The two halves rehydrate at different times, on purpose. `preferences` is
persisted and comes back immediately; `auth.user` is **deliberately not persisted** — it is
re-fetched from `GET /api/v1/me` on every launch so a revoked role cannot linger. So there
is a real interval, plus the entire sign-in screen, during which `auth.user` is `null` and
there is no per-user value to read.

**Fix.** Make the no-user case explicit rather than incidental. `selectReduceMotionFor`
takes a nullable user id and returns the same default a first-time user gets:

```ts
export function selectReduceMotionFor(byUser, userId) {
  if (!userId) return REDUCE_MOTION_DEFAULT;
  return byUser[userId]?.reduceMotion ?? REDUCE_MOTION_DEFAULT;
}
```

Because the fallback equals the default, nothing changes underneath someone as their profile
lands, and the app never animates at an account it has not yet asked. The alternative —
remembering the last signed-in user's value to avoid the flicker — would briefly apply the
previous worker's setting to whoever is holding the phone, which is the exact leak the
per-user change exists to close.

**Accepted cost:** the v3→v4 migration drops the old device-level value rather than
attributing it to anyone. Nothing in persisted state can name the person it belonged to,
precisely because `auth` is not persisted. Guessing would be wrong on a shared phone, so one
person re-sets one switch once.

---

## SCRUM-209 Part 2 — Live weather from the ingestion API

Plan: [`docs/plans/SCRUM-209-rest-swipe-fix-and-live-weather-plan.md`](../docs/plans/SCRUM-209-rest-swipe-fix-and-live-weather-plan.md).
Part 1 (the rest-card swipe bug) is on `feat/scrum-209-rest-swipe-fix` and is not in this
branch.

The Conditions screen no longer runs on simulated data outside `mock` auth mode. Every number
on it — WBGT, air temperature, humidity, wind, rainfall, station, observed/ingested times,
freshness — now comes from the NEA ingestion the backend already had, and the WBGT band comes
down beside it **already evaluated by the server**.

### What was actually missing was the band, not the reading

The reading was never the hard part. `GET /api/v1/sites/{siteId}/weather/latest` already
existed, already `@PreAuthorize`-scoped to site membership, and its response already mapped
almost one-to-one onto the app's `SiteConditions`.

What no endpoint in the backend exposed — checked across all six controllers — was the **WBGT
band**. And §12.2 forbids a client submitting or overriding one, with FR-15 making the backend
engine authoritative for anything that decides what a worker must do. So the app could not
simply switch the reading to live and keep computing the band locally; that would have been
the client deciding a safety verdict.

Hence the ticket carries both halves, and the backend half had to land first.

**Backend (this branch):**

- `weather/domain/WbgtBand.java` — new. §7.1's four bands, half-open (`32.0` is
  `BAND_32_TO_BELOW_33`, not `BAND_31_TO_BELOW_32`), compared with `compareTo` so
  `32.00` and `32.0` classify identically.
- `WeatherController.LatestWeatherResponse` — gained a trailing `band` field populated by
  `WbgtBand.classify(observation.getWbgt())`.
- `WbgtBandTest` — 13 cases, every boundary plus null plus BigDecimal scale.

**The wire names are not the Java constant names.** A Java identifier cannot start with a
digit, so the constants are `BAND_31_TO_BELOW_32` while the JSON says `31_TO_BELOW_32` — via
`@JsonProperty` on each constant. That direction was chosen deliberately: the app's
`WbgtBand` type and its `wbgt.band.*` translation keys already use the digit-leading form, so
prefixing the wire would have forced a mapping layer into every client, and a mapping layer
is a thing that drifts.

**A null WBGT yields a null band, not `BELOW_31`.** `BELOW_31` is the tempting default and
the dangerous one: it makes "no reading" and "the coolest band" indistinguishable on screen,
assuming the safest interpretation for the case where nothing at all is known.

### Mobile changes

| File | Change |
|---|---|
| `api/endpoints/safety.ts` | New `fetchSiteWeather(siteId, workerId)` — real call outside mock mode |
| `store/reducers/weatherSlice.ts` | `policy: PolicyEvaluation \| null` → `band: WbgtBand \| null` |
| `screens/weather/WeatherScreen.tsx` | Renders `band`; new no-reading empty state |
| `localization/*.json` | `weather.noReadingTitle`, `weather.noReadingBody` × 7 locales |
| `api/endpoints/safety.test.ts` | New — 7 tests over the mapping boundary |

### Why a new function rather than switching `fetchSiteConditions`

`fetchSiteConditions` has two callers and only one of them could go live.

`weatherSlice` resolves its site id from the **real** `GET /api/v1/sites`, so it holds a site
id the backend recognises. `safetySlice` gets its site id from `fetchMyShift`, which is still
a mock — `GET /api/v1/shifts/me` does not exist — and returns the seeded demo UUID
`11111111-…`, which `DemoDataSeeder` does **not** create (it generates random ids per site).
Switching the shared function would have pointed the shift screen at a site id no deployment
has, turning its conditions card into a 403.

So `fetchSiteConditions` is untouched and still fully mocked, and the weather screen got its
own function. The shift screen goes live when `/shifts/me` and `/conditions` do.

### What the weather screen gave up, and why that is correct

`weatherSlice` no longer holds a `PolicyEvaluation`. It held one to read a single field off
it, and the rest — the mandatory and advisory actions — depends on a worker's own task
intensity and acclimatisation. Site-wide, those actions apply to nobody in particular, so
holding them on this screen was an invitation to render them. The live endpoint returns no
policy at all, which made the removal forced rather than optional.

Nothing was removed from the screen: it never rendered the actions. Its own header comment
says so, and that reasoning is unchanged.

### Text stripped from the wire shape

The response carries two fields that must not become part of `SiteConditions`:

```ts
const { id: _id, band, ...observation } = wire;
```

`id` is the `weather_observation` row's primary key and nothing on the client needs it;
`band` is a verdict *about* the reading, not part of it. A spread would have smuggled both
into a typed domain object — `api/endpoints/safety.test.ts` asserts neither survives.

### A 404 is an answer, not a failure

The endpoint 404s when a site has no stored observation — true for a newly created site
before the ingestion scheduler's first run. That is caught and returned as
`{ observation: null, band: null }`; anything else, including a 403, still rejects.

Which exposed a pre-existing gap: the screen rendered `conditions && derived ? … : null`, so a
site with no reading produced a **blank page under a site picker** — indistinguishable from a
broken app. Only reachable live, because the mock always has a reading. New empty state:

> **No reading yet**
> This site has no weather reading yet. It will appear once the next reading is ingested.

Guarded on `status === "ready" && selectedSiteId !== null` so it does not stack on top of the
existing no-memberships empty state, which is also conditions-less.

### Band absent vs. band unknown

```tsx
{band ? <AppText variant="label">{t(`wbgt.band.${band}`)}</AppText> : null}
```

Unchanged in shape from the `policy.currentBand` version — it was already null-guarded. The
guard now means something different, though: previously "no policy loaded", now "the reading
exists but its WBGT could not be derived". Rendering the coolest band there would turn
*unknown* into *safe*.

### Reverting

To put the weather screen back on simulated data: change `fetchSiteWeather` to return the
`isMockApi()` branch unconditionally. Nothing else has to move — `mockConditions` is intact
and is still the contract for the unbuilt `/conditions` endpoint.

To drop the band from the API: remove the `band` field from `LatestWeatherResponse`, delete
`WbgtBand.java` and its test, and revert `weatherSlice` to holding a `PolicyEvaluation`.

### Verified

- `WbgtBandTest` — 13 passed.
- Full backend `mvnw verify` — **181 tests, 0 failures**, including `WeatherControllerTest`
  asserting `$.band == "31_TO_BELOW_32"` against the real MockMvc contract (Testcontainers,
  so it needs Docker running — it errors out entirely without it, which is not a test
  failure and should not be read as one).
- Mobile `npm test` — **68 passed**, 6 suites, of which 7 tests are new.
- `npm run typecheck`, `npm run lint` (0 errors), `npm run check:locales` — 290 keys, all
  seven locales in parity.

Not yet exercised against a live deployment — the emulator runs `mock` auth mode, which
takes the other branch by design.

---

## SCRUM-208 — Alerts rename and unacknowledged badge

Plan: [`docs/plans/SCRUM-208-alerts-rename-and-badge-plan.md`](../docs/plans/SCRUM-208-alerts-rename-and-badge-plan.md).

The Inbox is now **Alerts**, and its tab icon carries a live count of the actions the worker
still owes: `3`, then `2`, then no number and a bell with a tick.

### The count, and what it deliberately includes

```
unacknowledged = visibleDispatches.filter(item => !acknowledged[item.id]).length
```

| Case | Counts? | Why |
|---|---|---|
| Pending | yes | owed |
| Acknowledgement **in flight** | yes | stops counting when the *server* confirms, not when the button is pressed |
| Acknowledgement **failed** | yes | owed until the server says otherwise; the card keeps its retry |
| **Rest in progress** | **no** | the record exists the moment the server confirmed — the timer is a separate concern |
| Dismissed (SCRUM-207) | no | already gone from the list |

The rest case is the one the story asked for by name, and it needed no code: it falls out of
"has an acknowledgement record". Special-casing it would have been the way to get it wrong.

### The count lives in the slice, not the screen

`selectVisibleDispatches` / `selectUnacknowledgedCount` / `selectAllAcknowledged` are memoised
selectors on `dispatchInboxSlice`, and `InboxScreen` now reads the first of them instead of
deriving its own list.

The badge is drawn by the tab navigator while other screens are in front, so the screen cannot
own the derivation. Two copies of "what is on screen" drift the moment one of them learns
about a new state — and the thing that would then be quietly wrong is a count of outstanding
safety instructions.

### The poll had to move, and that is the real change

`useAutoRefresh` is `useFocusEffect`-based: the inbox polled only while its own screen was
focused. That is correct for a screen's own data, and the battery reasoning in that file
stands.

It is wrong for a badge. A tab badge exists to report what arrived **while the worker was
somewhere else**, so under the old arrangement a newly dispatched action would not move the
count until the worker opened the very screen the badge was meant to send them to. The NFR is
"visible to an online worker within 60 seconds" and focus-gated polling cannot meet it from
another tab.

So the dispatch poll moved to `WorkerTabs` via a new `useForegroundRefresh` — same
foreground-awareness, no focus gate. **Nothing polls while the app is backgrounded**; the
battery argument still holds there, and a phone in a pocket has nobody to show a badge to.
`InboxScreen`'s own poll was removed rather than left in place, or every request would have
doubled whenever Alerts happened to be the screen in front.

Weather and shifts stay focus-gated. Neither drives anything visible from another screen.

### Icon states

| State | Icon | Badge |
|---|---|---|
| One or more unacknowledged | bell | the count |
| All acknowledged, cards still on screen | bell + green tick | none |
| List empty | bell | none |

An empty list gets the **plain** bell. "Nothing has arrived" and "you have dealt with
everything" are different facts and only the second earns a tick — `selectAllAcknowledged`
checks `visible.length > 0` for exactly that reason.

The tick is composed over the bell rather than swapped for a different glyph, so the icon
gains a mark instead of appearing to change shape. It is drawn in the success colour, not the
tab tint: the tint says which tab is selected, the tick says the work is done, and those must
not be the same signal.

The count is also stated in words via `tabBarAccessibilityLabel` — "Alerts, 2 unacknowledged"
— because a small numeral on a tab icon is the first thing to disappear in glare, and is
invisible to a screen reader entirely.

### Rename scope

`tabs.inbox` → `tabs.alerts`, valued "Alerts" in all seven locales. One key drives both the
tab label and the stack header, so they cannot drift.

`InboxScreen.tsx`, the `inbox.*` block, `dispatchInboxSlice` and `api/endpoints/dispatch.ts`
keep their names. They track the API concept —
`GET /api/action-dispatch/worker/{id}/pending` really is an inbox of dispatched actions — not
the label a worker reads. Renaming them would bury the behaviour change in a large diff and
move the code further from the endpoint it mirrors.

### Verified on device

Badge showed `3` **while on My shift**, which is the whole point — then `2` after
acknowledging the rest card *with its timer still running*, then `1`, then no badge and the
checked bell. Header and tab both read "Alerts".

**One finding worth a decision.** In Burmese the badge renders `3` in ASCII while the shift
times on the same screen render `၉:၁၄` in Burmese numerals, because `Intl` formats the times
and React Navigation renders the badge value directly. Left as ASCII deliberately: the badge
is a compact glyph on an icon where Burmese numerals are wider, and the count is already
announced in words for anyone the numeral fails. It is an inconsistency, not a defect — but
it is a product call, so it is recorded here rather than left to be discovered.

No tab label truncated in Burmese, which was the other flagged risk.

---

## SCRUM-207 — Auto-dismiss and swipe-to-clear

Plan: [`docs/plans/SCRUM-207-inbox-auto-dismiss-and-swipe-plan.md`](../docs/plans/SCRUM-207-inbox-auto-dismiss-and-swipe-plan.md).
Builds directly on [SCRUM-206](#scrum-206--rest-timer-and-progress-bar) — same deadline
field, same removal path, second source for the deadline.

Acknowledged cards leave the inbox on their own. A rest card leaves when the rest is served;
everything else leaves three minutes later. A swipe makes it sooner.

### One deadline, three sources

| Action | Dwell | Bar |
|---|---|---|
| `REST_<n>_MIN` | the parsed duration | yes |
| Any other code — `HYDRATE`, `ROTATE_TO_LIGHT_DUTY`, … | 3 minutes | no |
| A `REST_*` code that cannot be parsed | 3 minutes | no |
| Swipe, any acknowledged card | immediate | — |

`dismissAtFor` is the single entry point; `restDeadlineFor` stays separate because the *bar*
needs a different question answered. "Three minutes because we did not understand the code"
is not a rest, and a bar counting down against it would be counting down to nothing. That
distinction is stored as `hasRestTimer` on the acknowledgement record rather than re-derived
per render, so a later change to the parsing rules cannot retroactively change what
already-acknowledged cards display.

The unparseable-rest case matters more than it looks: the action catalogue is deliberately
open-ended server-side, so an unknown `REST_*` code is expected eventually. Without the
fallback it would sit in the inbox forever — the one outcome this epic exists to remove.

### Three minutes is a dwell time, not a policy value

`DEFAULT_DISMISS_MS` lives in `helpers/restDuration.ts`, not in the policy engine and not in
`application.yml` beside the WBGT thresholds. Nothing about the worker's obligation changes at
three minutes: the action was owed before they acknowledged it and discharged after, and the
card going is a UI event with no safety meaning. FR-15 makes the backend authoritative for
anything that decides what a worker must do — a confirmation's screen time is not that, and
filing it beside things that are would invite someone to treat it as if it were.

### Two timers, deliberately

- **Card with a bar** — `useNow` at 1Hz. The component re-renders every second anyway to move
  the countdown, so the clock is free, and it reports its own completion.
- **Card without a bar** — `useExpiryTimer`, a single `setTimeout`. Nothing to redraw, so
  ticking at 1Hz would be ~180 renders over three minutes to discover that nothing changed.

`useExpiryTimer` also listens to `AppState`. A JS timeout is not reliable across
backgrounding and a long one can be throttled or dropped, so the deadline is re-checked on
return to foreground; the timeout is the fast path and `AppState` is what makes it correct.
Both funnel through one guarded `fire()`, so a race produces exactly one call. The callback is
held in a ref — callers pass an inline arrow, and as a dependency it would rebuild the timeout
on every render, meaning a three-minute timer would never fire at all.

Only one of the two is active per card, so nothing races to dismiss the same row twice.

### The swipe

`Swipeable` from `react-native-gesture-handler` 2.32 — already a dependency, with
`GestureHandlerRootView` already at the app root. **Not** `ReanimatedSwipeable`:
`react-native-reanimated` is not installed, and adding it is a native dependency on a project
that has never produced an EAS build.

**Only acknowledged cards are swipeable.** A pending action is still owed and the supervisor
has not been told — flicking it away would make the inbox lie about what is outstanding. A
failed one is worse: the retry button lives on that card, so dismissing it removes the only
route back. Both are blocked, and the card still renders normally.

Either direction, because a worker in gloves should not have to remember which. The revealed
panel fades in with the drag so a partial swipe reads as "keep going" rather than "done" — on
a gloved hand, most swipes are partial. Threshold is a generous 96pt: brushing the list while
scrolling and losing a card is a worse failure than having to swipe a little further.

Removal is from the rendered list only. The persisted acknowledgement record is untouched, so
idempotent replay (SCRUM-186) and SCRUM-130's queue are unaffected.

### Verified on two device geometries

`Pixel_9_Pro_XL` (1344×2992 @480) and `Pixel_10_Pro_Fold` (2076×2152 @390) — the pair that
exposed [Problem 10](#problem-10--button-labels-silently-truncated-at-a-space-on-every-card-but-the-first),
where one reproduced a bug the other did not from the same bundle.

| Check | XL | Fold |
|---|---|---|
| Swipe on a **pending** card does nothing | ✅ | ✅ |
| Swipe on an acknowledged card removes it | ✅ | ✅ |
| Neighbouring card untouched | ✅ | ✅ |
| Reveal panel renders and tracks the drag | ✅ | ✅ (`Padam`, in Malay) |
| Acknowledged non-rest card shows **no** bar | ✅ | ✅ |
| 3-minute auto-dismiss | ✅ removed at t=182s | — |
| List still scrolls with a swipe half-open | — | ✅ |

> Two invalid test runs are worth recording, because both looked like product bugs. The first
> half-swipe-then-scroll test targeted a **pending** card, which by design cannot open — so it
> proved nothing about gesture conflict. An earlier removal test reported `~5s` because the
> card had already been dismissed in a previous run and `dismissedIds` had correctly persisted
> it. **Check the fixture is in the state you think it is before believing a timing result.**

---

## SCRUM-206 — Rest timer and progress bar

Plan: [`docs/plans/SCRUM-206-rest-timer-progress-plan.md`](../docs/plans/SCRUM-206-rest-timer-progress-plan.md).
[SCRUM-207](../docs/plans/SCRUM-207-inbox-auto-dismiss-and-swipe-plan.md) — the 3-minute rule
and swipe-to-clear — builds on the same mechanism and is not implemented yet.

Acknowledging a `REST_*` action shows a progress bar and a countdown; the card removes itself
when the rest is served.

### The duration never comes from the title

`helpers/restDuration.ts`. Resolution is **server `endTime` → `REST_<n>_MIN` parsed from
`actionCode` → no bar.** The rendered heading is a translated string:

| Locale | Title |
|---|---|
| `en` | Rest for 15 minutes |
| `ta` | 15 நிமிடம் ஓய்வெடுங்கள் |
| `my` | ၁၅ မိနစ် အနားယူပါ — Burmese numerals, not ASCII |
| `bn` | ১৫ মিনিট বিশ্রাম নিন — Bengali numerals |

A regex over that works in English and fails in six of the seven shipped languages, and
breaks again the first time a translator rewords a sentence.

The pattern is **anchored** (`^REST_(\d+)_MIN$`) and the anchoring is load-bearing:
`REST_10_MIN_HOURLY` is a *policy* action from the heat plan — "rest 10 minutes every hour" —
with no single deadline. An unanchored pattern would match it and start a countdown against a
rule that does not have one. An unrecognised code gets no bar at all, which is a requirement
rather than a fallback: the action catalogue is deliberately open-ended server-side.

### What is persisted, and why the timer survives a kill

`dismissAt` is computed **once**, at acknowledgement, and stored on the acknowledgement record
that `dispatchInboxPersistConfig` already persists. Two consequences:

- A fifteen-minute rest survives the app being killed. Recomputing from "now" on relaunch
  would restart it, punishing a worker for something they did not do — and on a site phone a
  process death mid-shift is not an edge case.
- The deadline cannot drift. Deriving it during render would push the finish line forward on
  every tick.

Wall-clock rather than elapsed-since-mount, because a monotonic timer cannot survive process
death. **Accepted cost:** changing the device clock can end a rest early. Documented rather
than defended against — the threat model is a worker skipping a rest, their supervisor can
already see the acknowledgement, and clock-tamper detection is more code and more edge cases
than the risk earns.

`dismissedIds` is persisted separately. The acknowledgement records deliberately survive
dismissal — they are what keeps a replayed acknowledgement idempotent (SCRUM-186) — so
without a dismissed list, relaunching would rebuild every expired card from them.

### Card-driven expiry, not list-driven

The card already ticks for its own countdown, so the card is what notices the deadline and
dispatches `dismissed(id)`. A clock at the list would re-render every row once a second to
discover that nothing had changed. The list then re-renders on a real event instead of on a
schedule.

`onComplete` fires from an effect, not the render body, and is guarded by a ref — `useNow`
keeps ticking past the deadline, so without the guard every subsequent second would fire
again.

### The bar is essential motion

Exempt from the in-app Reduce Motion preference, still stopped by the OS setting — the same
carve-out `AnimatedIcon`'s `essential` prop defines for the stop-work pulse. SCRUM-199 made
the in-app preference default to *on*, so without the exemption the bar would be frozen for
every worker who has never opened Settings, and a progress bar that does not progress is a
broken feature rather than a calmer one.

**The numeric countdown always renders**, bar or no bar. It is the copy that survives an OS
that has been told to stop animating, a screen reader, and glare at arm's length. The
animation is the pleasant version of the truth, never the only copy of it.

### Verified on device

| Check | Result |
|---|---|
| No bar before acknowledgement, or on a non-rest card | Confirmed |
| `REST_15_MIN` → `14:56 left`, bar filling | Confirmed |
| `REST_1_MIN` → `0:55 left` — same code, different duration | Confirmed |
| Kill and relaunch mid-rest resumes (`13:22 left`, not 15:00) | Confirmed |
| Card auto-removes at the deadline | Confirmed via logcat timestamps |

> **A measurement note worth keeping.** The auto-removal looked broken twice — it appeared to
> fire at ~17s instead of 60s. It was not: the elapsed time was being measured from the start
> of each *tooling command*, while the acknowledgement had happened in a previous one, so ~43s
> had already passed unrecorded. `adb logcat` settled it in one step because its lines carry
> **absolute** timestamps: acknowledged 00:35:41.178, `dismissAt` 00:36:41.178, countdown
> running continuously to 8100ms at 00:36:33. When a timing result looks wrong, check what the
> clock is anchored to before changing the code.

---

## SCRUM-205 — Localisation

Plan: [`docs/plans/SCRUM-205-localisation-plan.md`](../docs/plans/SCRUM-205-localisation-plan.md).
**All seven languages have landed.**

| Language | Code | Script | Family | Status |
|---|---|---|---|---|
| English | `en` | Latin | Gelasio | Shipped — source of truth |
| Simplified Chinese | `zh-Hans` | Han | Gelasio + system | Shipped |
| Hindi | `hi` | Devanagari | Gelasio + system | Shipped — see the Hindi note below |
| Malay | `ms` | Latin | Gelasio | Shipped — machine-drafted, awaiting native review |
| **Tamil** | `ta` | Tamil | **Noto Sans Tamil** | Shipped — machine-drafted, awaiting native review |
| **Bengali** | `bn` | Bengali | **Noto Sans Bengali** | Shipped — machine-drafted, awaiting native review |
| **Burmese** | `my` | Myanmar | **Noto Sans Myanmar** | Shipped — Unicode only, awaiting native review |

### Why Malay went first

It was the only one of the four in Latin script, so it rendered in Gelasio with no font work
at all. That made it the vertical slice: it exercised `languagesArr`, the `AppLanguage` type,
`resolveDeviceLanguage`, the i18n registration and both pickers — the Settings sheet and the
sign-in screen — with the font problem held out. It also surfaced a latent `AppButton` layout
bug (Problem 10) that had nothing to do with localisation and everything to do with being the
first two-word label in the app.

### The font layer

Gelasio (`src/styles/fonts.ts`) covers Latin, Cyrillic and Greek and has **no glyphs at all**
for Tamil, Bengali or Myanmar. Rendering them in it produces tofu, or a silent fall back to
whatever the system has. So each script gets its Noto family:

- `familyFor(language)` resolves the family from the **active language**, not by inspecting
  each string. Every string is in one language at a time, so per-string script detection
  would cost work on every text node to answer a question the language already answers.
- The Noto families include basic Latin, so `32.4 °C WBGT` on a Tamil screen draws from one
  face instead of falling back per glyph.
- `lineHeightBoostFor(language)` widens the line box for the three new scripts. Bengali hangs
  a matra across the top of a word and all three carry vowel signs below the baseline; the
  1.35 ratio tuned for Gelasio clips them, and it clips *subtly* — a diacritic loses its top
  and the word is still nearly right, which is how a wrong word reaches a worker.
- All four weights (400/500/600/700) were **checked to exist** in all four families rather
  than assumed. Noto subsets do not uniformly ship every weight.
- Every family loads at startup in `App.tsx`. The same reasoning that bundles translations
  applies to the faces that draw them: a worker who loses signal mid-shift must not lose
  their language, and a font fetched on language-switch would fail on exactly the site phone
  this app is built for.

**Hindi is deliberately still on the system fallback.** It is Devanagari, which Gelasio also
lacks, but it shipped long before this change and has been rendering through the OS all
along. Moving it to a Noto family is a visual change to an already-shipped language and
deserves its own ticket with its own before-and-after — not a silent ride-along in this one.

### Burmese is Unicode only

Recorded here because the plan required the decision be made explicitly and because the
failure mode looks like a bad translation rather than an encoding mismatch.

`my.json` is Myanmar **Unicode** (U+1000–U+109F), not Zawgyi. Myanmar's national migration to
Unicode completed in 2019 and Android 12+ ships Unicode Myanmar fonts, so Zawgyi is treated as
legacy: not detected, not transcoded. A worker on a Zawgyi-only device sees garbled Burmese
and can switch language from the sign-in picker, which is reachable precisely so that a phone
left in an unreadable language is never a dead end.

**Do not "fix" garbled Burmese by transcoding the file to Zawgyi.** The file carries the same
warning in its `_encoding` key.

### Translation review status — read before shipping `ms`

`ms.json` is **machine-drafted and has not been reviewed by a native speaker.** The file
carries this warning in its own `_translationStatus` key, and `i18n.ts` repeats it at the
registration site.

The same is true of `ta.json`, `bn.json` and `my.json`.

These keys must be signed off by a native speaker of each language before it is offered in
production:

- `lightning.*` — the stop-work and advisory banners
- `actions.*` — every dispatched instruction
- `guidance.*` — the heat plan (currently behind `features.heatGuidanceCard`)
- `wbgt.superseded`, `freshness.staleWarning`, `freshness.delayedWarning`

A mistranslated stop-work instruction is an incident, not a typo.

Two judgement calls in the draft worth a reviewer's attention:

- **`lightning.stopWorkTitle` → "BERHENTI KERJA".** Kept in caps to match the English, which
  is the loudest string in the app.
- **`inbox.acknowledgeButton` → "Akui terima"** rather than a bare "Akui". The worker is
  confirming *receipt* of an instruction, not agreeing with it, and the distinction matters
  on a screen whose whole purpose is proving the instruction arrived.

### `id` (Indonesian) is deliberately not mapped to `ms`

`resolveDeviceLanguage` does **not** route Indonesian device locales to Malay, despite the
two being largely mutually intelligible in writing. They diverge in exactly the register
this app occupies — safety and workplace vocabulary — and silently showing an Indonesian
speaker Malay would be a guess made on their behalf about a stop-work instruction.
Indonesian falls through to English, and the worker can pick Malay themselves if they prefer
it. Same reasoning as the existing `zh-Hant` carve-out.

### Server-authored text cannot be translated by this app

Found while reviewing the Inbox in Malay: the action **titles** translated, the instruction
**bodies** stayed in English.

That is not a missing key. `ActionDispatch.instruction` is free text the server authors — a
supervisor's own words attached to a dispatched action — and `DispatchCard` renders it
verbatim. No locale file can reach it, because it is runtime data rather than a key.

```
Rehat selama 15 minit                              ← actions.REST_15_MIN, translated
Take a continuous 15-minute rest in the shaded…    ← dispatch.instruction, server text
```

**What was done here.** The mock dispatch server now resolves its instruction bodies through
i18n at read time, which is what a localising server would do — the seed holds a key under
`dev.mockInstruction.*` and `materialise()` renders it per request. A language change shows
up on the next inbox poll rather than needing a restart.

**What that does not fix.** The real `ActionDispatchController` still returns whatever text
the supervisor typed. A Malay-speaking worker on the real backend reads the instruction in
the supervisor's language. The action title carries the safety meaning and *is* translated,
so this degrades rather than fails — but it needs a backend answer, and the options are the
usual three: translate at dispatch time, store a structured code plus parameters instead of
prose, or accept it and make the title authoritative. **Worth its own ticket.**

`ROTATE_TO_LIGHT_DUTY` was also added to `actions.*` in all four locales. It had been left
out deliberately so the card would demonstrate its `humaniseActionCode` fallback — but a
real catalogue code rendering in English on a localised screen is too high a price for a
demonstration. The fallback still guards every code the backend adds ahead of this app's
translations, which is the case it exists for.

### Verified on device, and what that turned up

All three new languages were driven on a 1344×2992 @480dpi emulator: language picker, My
shift, Inbox, Settings, and a force-stop-and-relaunch to confirm the choice persists.

- **All three scripts render.** No tofu, no system fallback. Burmese even picks up Burmese
  numerals in the shift window (`၁၉:၃၉ မှ ၂:၃၉`), because `Intl` formats against the active
  locale.
- **The Inbox is fully translated**, instruction bodies included — those come from
  `dev.mockInstruction.*` via the mock dispatch server, which resolves them through i18n at
  read time. Server-authored instruction text on the *real* backend is still untranslatable;
  see the note above.
- **Tab labels had to be shortened for Tamil and Burmese.** `என் பணிமுறை` and
  `ကျွန်ုပ်၏ အလှည့်` both truncated to `…` in the tab bar. No font or layout change fixes
  this — a tab bar has a hard width budget, and the honest fix is a shorter label. Tamil
  `tabs.shift`/`tabs.inbox` and Burmese `tabs.shift`/`tabs.profile` are therefore *not*
  literal translations of the English; they are tab-sized. This is the text-expansion risk
  the plan predicted, landing exactly where it said it would.

Still unverified: **iOS**, and the largest text setting in the new scripts. Both are where
the extra line-height matters most.

### Locale parity check

```bash
npm run check:locales
```

Fails the build when any locale drifts from `en.json`. Four fault classes, all of them
otherwise silent:

1. **Missing key** — i18next falls back to English and renders it mid-screen. No error, no
   warning, no crash. Invisible to `tsc` and to anyone reviewing a diff in a language they
   do not read.
2. **Extra key** — a stale key left behind by a removal, which is how a translator's work
   quietly stops being rendered.
3. **Placeholder drift** — a dropped `{{time}}` leaves a sentence with a hole in it; a
   renamed one prints literal braces to the user.
4. **Wrong script** — a string written in a script that belongs to a different locale.
   Added because it actually happened while drafting the three new files: one value in
   `ta.json` was Bengali. Valid JSON, right key, right placeholders, and unreadable to the
   person it was written for. A reviewer catches that only if they read both scripts.

The script check ignores Latin, which legitimately appears in every file — "CrewSafe",
"WBGT", "°C", the email placeholder. It also excludes U+0964/U+0965, the danda and double
danda: Unicode files them under Devanagari but they are shared Indic punctuation, and
treating them as Devanagari flagged every correctly written Bengali sentence. That was four
false positives before a single true one, and **a check that cries wolf on correct input is
worse than no check, because the next person turns it off.**

Keys beginning with `_` are metadata and are skipped. The script exits non-zero on failure,
so it can be wired into CI beside `tsc --noEmit`.

---

## SCRUM-196 / 197 — My shift screen reorder and strip

Two ordering tickets that arrived alongside a set of content removals. **Everything removed
here is recorded verbatim below so it can be put back by reference** — ask for "the
SCRUM-196/197 reversal list in the mobile README" and this section is the spec.

Nothing was deleted from the API, the domain types, or the mock server. Every removal is a
*display* change: `LightningRisk` still carries `nearestStrikeKm` and `observedAt`,
`SiteConditions` still carries every metric, and the policy engine still returns its full
evaluation. The data is on the wire; it is just no longer painted.

### Ordering (SCRUM-196, SCRUM-197)

`MyShiftScreen` render order:

| Before | After |
|---|---|
| 1. Lightning banner | 1. Lightning banner |
| 2. Freshness notice | 2. **Task view** (`ShiftCard`) |
| 3. Heat conditions (`WbgtCard`) | 3. *Heat plan (`HeatGuidance`) — now hidden* |
| 4. Heat plan (`HeatGuidance`) | 4. Freshness notice |
| 5. Task view (`ShiftCard`) | 5. **Heat conditions** (`WbgtCard`) |

The freshness notice moved **with** the reading rather than staying put. It exists to tell a
worker whether to trust that number, so separating the two would strand a warning above a
card it no longer refers to.

FR-12a is still satisfied. It constrains the lightning warning to sit *above* the WBGT
reading — moving the reading further down only reinforces that.

### Text removed from the lightning banner

| State | Removed / changed | Exact former text (en) | i18n key |
|---|---|---|---|
| Stop work, Advisory | **Removed** | `Nearest strike {{km}} km away` | `lightning.nearestStrike` |
| All live states | **Removed** | `Observed {{time}}` | `lightning.observedAt` |
| All live states | **Reworded** | `Expires in {{minutes}} min` → `Refreshes in {{minutes}} min` | `lightning.expiresInMinutes` → `lightning.refreshesInMinutes` |
| All live states | **Reworded** | `Expires in {{seconds}} s` → `Refreshes in {{seconds}} s` | `lightning.expiresInSeconds` → `lightning.refreshesInSeconds` |

`lightning.nearestStrike` and `lightning.observedAt` were **deleted from all three locale
files** (`en`, `hi`, `zh-Hans`). To restore, re-add:

```jsonc
// en.json, inside "lightning"
"nearestStrike": "Nearest strike {{km}} km away",
"observedAt": "Observed {{time}}",
// hi.json
"nearestStrike": "निकटतम बिजली {{km}} किमी दूर",
"observedAt": "{{time}} पर दर्ज",
// zh-Hans.json
"nearestStrike": "最近落雷距离 {{km}} 公里",
"observedAt": "观测时间 {{time}}",
```

**Why "Refreshes" and not "Expires".** The clock is unchanged; only the promise it makes is.
"Expires" invited reading the *hazard* as ending at zero, when what lapses is the server's
assessment — and the screen immediately polls for a new one. "Refreshes" describes what the
worker actually observes. Only a supervisor lifts a stop-work.

**Kept:** the Clear state's body line `Assessed clear at {{time}}.` (`lightning.clearBody`)
and the expired body `The warning lapsed at {{time}}. Resume work only when your supervisor
confirms the all-clear.` (`lightning.expiredBody`). Only the *meta row* was stripped.

### Text removed from the heat conditions card

`WbgtCard` was reduced to title, freshness badge, superseded label, and the WBGT reading.

| Removed | Exact former text (en) | i18n key | Status |
|---|---|---|---|
| Band | `32 to 33°C` etc. | `wbgt.band.*` | **Key kept** — still used by the Weather tab |
| Forecast | `Next hour: {{band}}` | `wbgt.forecast` | **Key deleted** |
| Air temp | `Air temp` + value | `wbgt.temperature` | **Key deleted** |
| Humidity | `Humidity` + value | `wbgt.humidity` | **Key deleted** |
| Wind | `Wind` + value | `wbgt.wind` | **Key deleted** |
| Observation time | `Observed {{time}}` | `wbgt.observedAt` | **Key deleted** |

To restore, re-add to the `"wbgt"` block:

```jsonc
// en.json
"forecast": "Next hour: {{band}}",  "observedAt": "Observed {{time}}",
"temperature": "Air temp",  "humidity": "Humidity",  "wind": "Wind",
// hi.json
"forecast": "अगले घंटे: {{band}}",  "observedAt": "{{time}} पर दर्ज",
"temperature": "तापमान",  "humidity": "नमी",  "wind": "हवा",
// zh-Hans.json
"forecast": "未来一小时：{{band}}",  "observedAt": "观测时间 {{time}}",
"temperature": "气温",  "humidity": "湿度",  "wind": "风速",
```

`WbgtCard` also **lost two props**, `policy` and `locale`, which became unused once the band,
forecast and timestamp went. Restoring any of those rows means restoring the props and
passing `policy={policy} locale={i18n.language}` from `MyShiftScreen`.

**On "the temperature should follow NEA data":** it already does, and no code change was
needed. The card renders `conditions.wbgt` straight from the API response. In mock mode that
is a fixture (32.4, badged *Simulated*); once `GET /api/v1/sites/{siteId}/conditions` exists
it becomes the real ingested observation with no edit to this file. **That endpoint still
does not exist** — see [Backend gaps](#backend-gaps).

### The "What you must do" card — hidden, not deleted

Controlled by `features.heatGuidanceCard` in `src/constants/features.ts`. **Set it to `true`
to restore. Nothing else needs to change.**

`HeatGuidance.tsx` is untouched and still compiles — it is rendered behind the flag rather
than commented out, precisely so it stays typechecked. Commented-out JSX is invisible to
`tsc` and rots the moment a prop or translation key moves underneath it; the rot is then
discovered by whoever uncomments it, which is the worst possible moment.

**What is not visible while the flag is off:**

| Lost | Requirement |
|---|---|
| Mandatory heat actions — `Drink water at least once an hour`, `Rest 10 minutes without a break, every hour` | FR-15 |
| Section headings `What you must do` / `Also recommended` | — |
| Rule references — `Rule HS-31-HYDRATE`, `Rule HS-32-HEAVY`, `Rule HS-BASE-SHADE` | **FR-16** |
| Policy version — `Policy MOM-WBGT-2026.1-MOCK` | **FR-16** |
| Worded stop-work override — `Suspended — lightning stop-work overrides the heat plan` | FR-12a |

No translation keys were deleted for this — the whole `"guidance"` and `"actions"` blocks
are intact in all three locales, because the component still references them.

> **This is the removal with the most weight behind it.** `HeatGuidance` was the app's only
> surface for the deterministic policy engine's output. The dispatch Inbox is *not* a
> substitute: it shows actions a **supervisor** approved and sent, not what the policy
> requires on its own. While the flag is off, a worker on a HEAVY task at 32.4°C WBGT is not
> told in-app that an hourly ten-minute rest is mandatory, and no rule reference or policy
> version is shown anywhere — which is what FR-16 asks for.
>
> The FR-12a override survives, in words, via `WbgtCard`'s *Superseded by the lightning
> stop-work* label. That label is now load-bearing and should not be removed while this flag
> is off.

### Lightning banner: all live states now filled

Clear and Advisory became filled blocks with white text, matching Stop work. Expired keeps
its outline — it is explicitly *not* an all-clear, and giving a lapsed assessment the same
weight as a live one is the one misreading that matters.

This required a new palette entry. White text on the existing advisory amber **failed WCAG
AA**:

| State | Fill | White text | AA (4.5:1) |
|---|---|---|---|
| Stop work | `#C71A34` | 5.79:1 | pass |
| Advisory — **old** | `#B26A00` | **4.24:1** | **fail** |
| Advisory — **new** `warningFill` | `#9A5B00` | 5.43:1 | pass |
| Clear | `#1B5E20` | 7.87:1 | pass |

`warningFill` is a *fill* colour only. `warning` is unchanged and still correct for warning
text and borders on a light surface. Two names because they solve opposite problems: one
must be legible **on** white, the other **under** it. High contrast reuses its existing
`#7A4600` (7.77:1), which already passed.

**No new icon was imported, deliberately.** Both icons draw in `foreground`, which turns
white the instant the banner is filled, so they inherit exactly the same contrast as the
text beside them. There was no clash to fix.

**What now distinguishes Stop work**, since fill no longer does: a 30px icon vs 24px, a
`title` vs `subtitle` heading, and the `urgent` pulse against Advisory's `steady` and Clear's
stillness. That redundancy is load-bearing — colour washes out first in glare and fails first
for red-green colour blindness — and a future consistency pass should not flatten it.

---

### Problem 10 — Button labels silently truncated at a space, on every card but the first

**Symptom.** The Malay inbox rendered the acknowledge button as **"Akui terima"** on the
first card and **"Akui"** on every card below it. No ellipsis, no error, no warning. It
survived a full reload, so it was not Fast Refresh leaving stale cells.

**What it was not.** The first instinct — a missing or wrong translation — was wrong, and
checking cost nothing: `ms.json` contains exactly one `inbox.acknowledgeButton`, its value is
`"Akui terima"`, and no key anywhere in the file produces a bare `"Akui"`. All three buttons
were being handed the same string. `AppButton`, `AppText` and `DispatchCard` have no
`numberOfLines`, `ellipsizeMode` or `adjustsFontSizeToFit` between them, so nothing was
deliberately truncating either.

**Two wrong diagnoses first**, both plausible, both shipped, neither correct. Recorded because
the reasoning that produced them is the trap:

1. *"The row is under-measured in a virtualised cell."* Gave the content row `width: "100%"`.
   No effect.
2. *"A `Text` that is itself the flex-shrinking node clips instead of wrapping."* Moved the
   shrink onto a `View` wrapper. No effect.

Both were inferred from the symptom without measuring. The device split — a Fold rendering
correctly beside an XL that did not, same bundle — was read as evidence *for* a
geometry-dependent measurement path, when it was really just a clue that something depended
on available width. **Reasoning about layout produced two confident, wrong answers; the
first measurement produced the right one in a single step.**

**What measurement showed.** An `onLayout` probe on every node, plus Android's own
accessibility tree via `uiautomator dump`, on a 1344×2992 @480dpi emulator:

```
Yoga    "Akui terima"  content=326.0  wrap=97.3  text=97.3  h=24.3   ← identical on all 3
Android text="Akui terima"  bounds [525,1038][817,1111]              ← 292px = 97.33dp × 3
        text="Akui terima"  bounds [525,1931][817,2004]              ← renders as "Akui"
```

The string was never truncated, the node was never wrong, and all three cards measured
**identically**. Yoga measured one line, 97.33dp wide. Android was handed a text box of
exactly that width, decided the line needed marginally more, and **broke at the space**. The
box is one line tall because Yoga measured one line — so the second line was clipped, and
`textAlign: center` re-centred the survivor. A clipped line disguised as a shorter string.

**The controlled experiment that proved it.** Same glyphs, space removed — `"Akuiterima"` —
rendered in full on every card. That isolates the line break as the trigger and rules out
width, font, virtualisation and locale in one step.

**Fix.** `flex: 1` on the label wrapper, so the label's box is derived from the button's
width instead of from its own measured content. There is then nothing marginal to get wrong.
Two device-independent pixels of slack were tried first and did *not* help, which is what
ruled out simple sub-pixel rounding.

Icon buttons keep the old shrink-to-fit sizing (`titleWrap`), because a full-width label
pushes the icon to the far edge and breaks the centred icon-plus-label pairing. They are not
exposed to the bug today: every icon button lives on a plain `ScrollView` screen, none inside
a recycled cell. **If an icon button is ever placed in a virtualised list, give it
`titleFill` and find another way to keep the icon adjacent.**

**Why English never showed it.** "Acknowledge" is a single word with nowhere to break. The bug
has been latent since the button was written and needed a two-word label to surface — which
localisation duly provided. Hindi and Chinese labels are long, but none had yet offered a
clean break point in the middle.

Verified on-device after the fix: both cards render "Akui terima", and `⚙ Tetapan` keeps its
icon beside the label.

> **Verify on more than one device.** This was invisible on one emulator and reproducible on
> another from the same bundle. A single-device pass would have signed it off twice: once
> because English has no space to break at, and once because the Fold is wide enough not to
> care.

> **Measure before theorising about layout.** Two fixes were shipped on inference and neither
> worked. `onLayout` logging and `adb shell uiautomator dump` — which reports the real text
> and bounds of every node — answered it immediately, and the no-space experiment confirmed
> it. Both are cheap; neither was tried until the third attempt.

> The general lesson is the one worth keeping: **a label that renders correctly in English is
> not evidence the layout is correct.** Truncation bugs hide behind single-word labels, and a
> translation is the first thing that will find them. This is an argument for reviewing
> screens in the *longest* language, not the default one.

---

### What this says about the checks

Static verification caught none of Problems 1–6. It is good at contracts and shapes and
useless at ABI compatibility, port ownership, framework freezing behaviour, and text
measurement. The lesson worth keeping: **get it onto a device before believing it works**,
and when something native fails, read `adb logcat -b crash -d` rather than reasoning about
the JS.

Problems 7–9 are the mirror image and worth separating. None of them are visible on a
device — not on a clean emulator, anyway, which is the only kind CI has. They live in
migration paths and rehydrate ordering, where the failure only appears on an install that
has *history*. `tsc` was silent on all three. What caught them was a comment someone had
written about a bug that had not happened yet, and asking of each piece of state: **who does
this belong to, and what does its absence mean?**
