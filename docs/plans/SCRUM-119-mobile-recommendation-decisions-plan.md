# SCRUM-119 (mobile) — Supervisor approves, edits or rejects a plan

US-09, on the React Native app. Subtask of SCRUM-119, whose backend half is already merged.

## Starting state, and why this is a subtask

The backend for US-09 shipped with the ticket that named it: `RecommendationController` serves
`GET …/recommendations`, `GET …/{id}` and `POST …/{id}/decision`, with reading open to
`SUPERVISOR`/`SAFETY_MANAGER`/`ADMIN` and deciding restricted to `SUPERVISOR`/`ADMIN`, a 409 on a
second decision, and the draft preserved alongside `editedPlan`. **Nothing in the mobile app had
ever called any of it.**

The fan-out to workers also already existed: `RecommendationService.fanOutDispatches` (SCRUM-193)
creates one `ActionDispatch` per worker per approved mitigation, and the worker Alerts screen has
consumed `/api/action-dispatch/worker/{id}/pending` since SCRUM-186. So "approved plans reach the
crew" needed no new plumbing — only a supervisor surface to trigger it.

## The blocker this had to clear first

Two facts made the ticket's translation requirement unsatisfiable as things stood:

1. `MitigationSuggestion` was four prose strings — `priority`, `action`, `rationale`,
   `estimatedImpact` — with **no action code and no category**. The SCRUM-118 design specifies
   both; SCRUM-118 was never built, so neither existed.
2. The fan-out dispatched the literal constant `AI_RECOMMENDED_ACTION`. No locale translates it,
   so `humaniseActionCode` rendered **"Ai recommended action" in English to every worker** — Tamil,
   Burmese, Bengali alike — and every mitigation on a plan looked identical in their inbox.

That is precisely the failure FR-26c and SCRUM-205 exist to prevent, and
[PR #134](https://github.com/zctiong-iss/crewsafe/pull/134) had already recorded the placeholder as
superseded.

**Decision: hybrid.** Add `actionCode` and `category` to the mitigation as nullable, additive
fields and fix the fan-out — the minimum that makes the requirement satisfiable — rather than
either shipping an untranslated screen or pulling SCRUM-118's whole contract forward into someone
else's module.

## Approved design

- **Render from `actionCode`, never from `action`.** The code resolves through `actions.*`, which
  ships in all seven locales. `action` is server-authored English shown only when a plan predates
  this change, with a note saying so rather than passing English off as a translation. Parsing the
  prose for numbers is forbidden for the reason SCRUM-206 documents: it works in English and fails
  in the other six.
- **`ActionCatalogue` is the allowlist and the mapping.** Recurring recommendation codes map to
  their one-shot dispatch forms — `REST_15_MIN_HOURLY` → `REST_15_MIN` — because mobile recovers
  the duration with `REST_(\d+)_MIN` and the recurring form leaves it matching a prefix. Everything
  else dispatches as itself, so a newly translated code is dispatchable without a second edit.
- **No lightning instruction in the catalogue, deliberately.** §7.1 requires "seek proper shelter";
  the nearest translated string is `SEEK_SHADE`, and shade is not shelter from lightning. That
  instruction already reaches workers as translated banner copy (`lightning.stopWorkBody`) and must
  not be approximated by an action code.
- **The allowlist is enforced server-side on an edited plan**, discharging §8.5. The supervisor's
  app only offers codes from the draft, so this is not defending against that app — it holds for
  every client.
- **Fields stay nullable.** `recommendation.draft_plan` is serialised JSON, so this needs no
  migration, and rows written before today keep deserialising and keep dispatching under the
  placeholder rather than failing. Old recommendations stay decidable.
- **A Plans tab, listing across shifts.** "What is waiting on me" is not a per-shift question even
  though the endpoint is per-shift. The slice fans out one read per shift and collects the answers;
  a partial failure drops that shift rather than blanking the screen.
- **Edit means narrow, not invent.** Remove, reorder, reword — never add. An action typed by hand
  has no policy rule and no forecast behind it and would sit beside ones that do, formatted
  identically. Removed rows stay visible and struck through so a supervisor can check their own
  work before it reaches a crew.
- **A rejection requires a reason.** A rejection with no reason is indistinguishable from a plan
  nobody read, and the point of a human in this loop is that their judgement is recorded.
- **A decision is terminal.** The server refuses a second with 409; the screen reloads and says who
  decided rather than offering a retry that cannot succeed.
- **Oversight reads, supervisors decide.** A safety manager sees the same screen with the buttons
  replaced by a line saying they may read but not decide — better than three buttons that each 403.

## What was built

**Backend** — `ActionCatalogue` (allowlist + dispatch mapping); `actionCode`/`category` on
`MitigationSuggestion` with a 4-arg constructor kept for existing callers;
`RecommendationService.fanOutDispatches` dispatching the real code;
`assertActionCodesAreKnown` on the edit path.

**Mobile** — `Recommendation`/`Approval`/`Mitigation`/`ActionCode` types; `api/endpoints/
recommendations.ts` and its mock; `recommendationsSlice`; `RecommendationsScreen` (list),
`RecommendationDetailScreen`, `EditPlanSheet`, `RejectSheet`, `MitigationRow`,
`RecommendationStatusPill`; the Plans tab and stack, plus an entry point on `ShiftDetailScreen`;
57 new locale keys across all seven languages.

**Local tooling** — `local/seed-recommendation.sh`, because nothing creates a recommendation until
SCRUM-118 exists.

## Verification

Backend 372 tests, up from 367. The load-bearing one is
`ActionCatalogueTest.everyDispatchableCodeIsTranslatedInEveryLocale`, which reads the seven shipped
locale files and fails the build if any dispatchable code lacks a translation — the promise checked
against the actual files rather than restated.

Mobile 182 tests, up from 170; typecheck clean, lint 0 errors, 378 locale keys in parity.

On the emulator against the live Cognito stack: seeded a three-action plan on a two-worker shift,
edited it down to two, and confirmed only those two dispatched, as `HYDRATE` and
`RESCHEDULE_HEAVY_WORK` rather than the placeholder. Signing in as the worker and switching to
Tamil translated both instruction titles while the server-authored detail stayed English — the
split the contract intends.

Two defects the unit tests could not see were found and fixed there: the status pill clipped its
longest label mid-word, and the edit sheet labelled its wording field "Reason".

## Dependencies

- **Depends on**: SCRUM-119 backend (merged), SCRUM-186/193 (the dispatch pipeline this feeds).
- **Does not depend on** SCRUM-118. When the agent lands it writes richer plans through the same
  fields; the app needs no change to render them.
- **Note for SCRUM-118**: `AI_RECOMMENDED_ACTION` remains as a fallback for pre-existing rows only.
  Agent-drafted plans must always carry a code from `ActionCatalogue`.

## Known limits

- The Plans tab issues one request per shift. Fine at demo scale; a site-scoped
  `GET /sites/{siteId}/recommendations?status=PENDING_APPROVAL` is the server-side fix if a site
  ever runs enough concurrent shifts to feel it.
- `evidence` from the SCRUM-118 design (observed/forecast WBGT, bands, freshness, station) is not
  on the response yet, so the screen shows the policy version and the agent's rationale and says
  "not recorded" where it has nothing. The layout has a place for the rest.
- No per-worker targeting on a mitigation (SCRUM-243): every approved action goes to every worker
  on the shift, and `appliesTo` from the design is not yet carried.
