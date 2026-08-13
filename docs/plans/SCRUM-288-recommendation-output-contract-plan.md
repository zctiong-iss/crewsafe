# SCRUM-288 — Extend recommendation output contract

## Outcome

`MitigationSuggestion` carries the full output contract the SCRUM-118 design doc specifies —
`origin`, `ruleReference`, `appliesTo`, `timing` alongside the `actionCode`/`category` SCRUM-119
already added — and `fanOutDispatches` actually uses `appliesTo` to target specific workers
instead of blanket-dispatching every mitigation to everyone on the shift. Closes SCRUM-243.

## Starting state

Three real gaps found by reading the running code, not the ticket description:

- **The allowlist rejection and dispatch-code mapping SCRUM-288's own Jira description asked
  for already existed** (`RecommendationService.assertActionCodesAreKnown` /
  `ActionCatalogue.toDispatchCode`, both from SCRUM-119). Nothing to build there.
- **`docs/api/recommendation.yaml` was stale even before this ticket** — its `MitigationSuggestion`
  schema never got `actionCode`/`category` added when SCRUM-119 shipped them. Two rounds of
  catch-up landed in one pass.
- **`BedrockMitigationService.java`, one of the four files the ticket named, has zero callers
  anywhere in the codebase.** `TestBedrockController` — the only plausible caller — actually
  calls a different class, `BedrockApiClient`. Left over from the SCRUM-187 Java-side spike,
  superseded once the SCRUM-118 design doc settled on `ml-service` (Python) as the real agent
  path. Updating its prompt schema would have been real effort spent on a path nothing runs.
  **Skipped, not built.**

## Approved design

Nothing here is new design — every field's shape was already decided in the SCRUM-118 design
doc's *Output contract* section and independently implemented once already, in `ml-service`'s
Pydantic model (SCRUM-287). This ticket is that same, already-agreed shape, ported to Java:

- All four new fields nullable, same backward-compatibility pattern SCRUM-119 established for
  `actionCode`/`category` — `recommendation.draft_plan` holds serialised plans written before
  these fields existed, and those rows must keep deserialising.
- `appliesTo` absent/null/empty means the whole shift, not "unknown" — the SCRUM-243 convention,
  kept consistent across the Java record, the Pydantic model and the YAML contract.
- **`fanOutDispatches` intersects `appliesTo` with the shift's actual current assignments**,
  rather than trusting the stored list outright. A plan drafted while a worker was on the shift
  must not dispatch to them after they've left it. A malformed worker id in a stored plan is
  skipped rather than failing the whole fan-out — losing one worker's dispatch is a smaller
  failure than losing the entire crew's.
- Dropped `ACCLIMATISATION`/`FASTING_ADJUSTMENT` from the YAML's `category` enum even though the
  design doc reserves them — no action code maps to either yet, and documenting them now would
  make the contract disagree with both the Java and TypeScript implementations. Add them when
  Ramadan mode actually lands.

## What was built

**Backend** — `MitigationSuggestion.java` (new `Timing` nested record, four new nullable
fields, legacy 4-arg constructor unchanged); `RecommendationService.fanOutDispatches` (targets
resolved per-mitigation via new `targetsFor`, intersected with the shift roster); three new
tests in `RecommendationControllerTest` proving targeted dispatch, whole-shift fallback, and
that a departed worker named in a stored plan receives nothing.

**Contract** — `docs/api/recommendation.yaml`: added the missing `actionCode`/`category`
(SCRUM-119 catch-up) plus `origin`/`ruleReference`/`appliesTo`/`timing` (SCRUM-288), new
`Timing` schema.

## Verification

Full backend suite: 447/447. Deliberately proved the three new tests aren't vacuous — reverted
`fanOutDispatches`'s targeting to always return the whole shift and confirmed exactly the two
targeting-specific tests failed (not the whole-shift-fallback one, which is correct — that
mitigation carries no `appliesTo` at all, so it's unaffected either way), then restored the real
implementation and confirmed 26/26 green again.

YAML validated by loading it and checking `MitigationSuggestion`'s and `Timing`'s properties
resolve as expected.

## Known limits

- **Mobile is not updated in this ticket, and that's deliberate, not an oversight.** Checked
  `mobile/src/types/domain.ts`'s `Mitigation` interface against the *pre-288* Java record —
  they matched exactly, so nothing is broken by adding new optional fields; TypeScript ignores
  fields it doesn't declare. But mobile's `Mitigation` type and its `MitigationRow.tsx` /
  `EditPlanSheet.tsx` screens won't be able to *show* per-worker targeting or the
  mandatory/advisory distinction until someone updates them — flagged as a real follow-up for
  whoever owns mobile, not bundled into this backend-and-contract ticket.
- **`BedrockMitigationService.java` and `BedrockApiClient.java` still return the old 4-field
  shape.** Neither sits on the real agent path (SCRUM-289 builds that, in `ml-service`), so
  this wasn't scope for 288 — noted here so nobody mistakes the silence for an oversight.
