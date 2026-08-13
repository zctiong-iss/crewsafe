# SCRUM-118 (mobile) — Supervisor receives an explainable agent draft plan

US-08, React Native only. Branched from `main`.

## What already exists

SCRUM-119's mobile surface is merged: a **Plans** tab, a recommendation detail screen with
approve / edit / reject, translated action codes via `ActionCatalogue`, and a link from a
recommendation to the policy version it cites (SCRUM-342). A supervisor can already *decide* on a
plan.

What they cannot yet do is **judge** one, which is what US-08 is actually about.

## What the analysis found

| | State |
|---|---|
| **#206 (SCRUM-287)** | `ml-service/` only — eval scenarios, scoring, Bedrock client. **No mobile impact.** |
| **#205 (SCRUM-288)** | Extends `MitigationSuggestion` with `origin`, `ruleReference`, `appliesTo[]`, `timing{}`. Builds on SCRUM-301's `actionCode`/`category` rather than colliding, and keeps the 4-arg constructor so SCRUM-119's tests still pass. **Mobile has none of the four.** |
| **`evidence` block** | **Does not exist on any branch.** No `observedWbgt`, `forecastBand`, `freshness`, `stationId`, `lightningState`, `modelVersion`, `trigger`. |
| **`.../recommendations/generate`** | **Exists nowhere.** SCRUM-289 will add it. |
| **`feat/scrum-118-agent-draft`** | Dead end: `/api/supervisor/agent-plans` over `agent_draft_plans`, which PR #134 recorded as superseded — `ActionDispatchService` needs an `Approval` row that table never creates, so an approved plan there can never reach a worker. Also 137 commits behind. |

## Approved design

- **Branch from `main`, treat the new fields as optional.** #205 keeps them nullable so SCRUM-119's
  tests pass with mitigations that omit them entirely — so a client that renders each only when
  present is correct both before and after #205 merges, and needs no rebase when it lands.
- **Render the explainability that is on the wire; do not invent the rest.** Policy version, the
  agent's rationale and per-mitigation `ruleReference` are real. The evidence block is not, and
  deriving observed/forecast WBGT client-side would be precisely the black box US-08 exists to
  prevent. It is raised as a backend subtask instead, and the layout leaves a place for it.
- **`origin` is the field that changes a decision.** `MANDATORY` is what the policy engine requires;
  `ADVISORY` is what the agent suggests on top. A supervisor editing a plan needs to know which
  actions are not theirs to remove — so it is a badge on the row, not a footnote.
- **`timing` is rendered from typed fields, never parsed from prose.** `durationMinutes` +
  `everyMinutes` compose into one translated phrase. Reading "15" out of the action text works in
  English and fails in the other six, exactly as SCRUM-206 documents for the rest timer.
- **`appliesTo` absent means the whole shift, and must say so.** Resolved to names from the shift
  roster the app already holds. Blank space cannot carry the difference between "these two people"
  and "everyone", and that difference is the point of the field.
- **The generate trigger ships behind a feature flag.** `.../recommendations/generate` does not
  exist, so an unflagged button is a 404 in a demo build. Flagged, it stays typechecked and
  testable, ships dark, and is one flag flip when SCRUM-289 lands — rather than a screen that has
  to be rediscovered and rewired weeks later.

## Sub-tasks

| # | Sub-task | Notes |
|---|---|---|
| 1 | Extend the mobile mitigation contract and fixtures | Types + mocks for `origin`, `ruleReference`, `appliesTo`, `timing`; all optional |
| 2 | Render an explainable mitigation | Origin badge, composed timing phrase, named workers, rule reference |
| 3 | Supervisor-triggered draft, behind a feature flag | Blocked on SCRUM-289; ships dark |
| 4 | **Backend dependency** — evidence block + `modelVersion` on the response | Not mobile work; raised so §12.2 is not silently dropped |

## Out of scope

- The React web console.
- Anything in `ml-service/` (#206).
- Editing `MitigationSuggestion` server-side — that is #205's job, and this branch deliberately
  does not touch it.
