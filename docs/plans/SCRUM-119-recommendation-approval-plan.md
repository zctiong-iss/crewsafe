# SCRUM-119 — Supervisor approves, edits or rejects a plan

## Outcome

A supervisor can now read a shift's AI-drafted recommendations and record an
approve/edit/reject decision on one, via a new contract
([`docs/api/recommendation.yaml`](../api/recommendation.yaml)) and its Spring Boot
implementation. A safety manager can read the same endpoints — including what a
supervisor decided and, for an edited decision, exactly what changed from the original
draft — but cannot decide.

## Starting-state correction

Surya Kumaraguru had already built `Recommendation`, `Approval` (and `ActionDispatch`) as
JPA entities and repositories, ahead of any of the three tickets that consume them. No
service or controller existed for `Recommendation`/`Approval` before this ticket — the
same gap `ActionDispatchService`/`ActionDispatchController` filled for `ActionDispatch`
under SCRUM-185. This ticket is that same kind of fill, one layer up the pipeline.

Where SCRUM-118 (the agent that drafts a `Recommendation`) and this ticket meet: SCRUM-118
is out of scope here entirely. This service only ever reads a `Recommendation` that
already exists; nothing in this PR creates one. Recommendations were seeded directly via
the repository in tests, the same way `ActionDispatch` rows were before SCRUM-185 existed.

## Approved design

- **A decision is recorded once, not corrected.** `approval.recommendation_id` is unique
  in the schema, and the service enforces the same rule at the API level: deciding on a
  recommendation that already has an `Approval` returns 409, not a silent overwrite or a
  second row. A decision is a record of what happened, not a draft to revise.
- **`editedPlan` is required (and non-empty) only when `decision` is `EDITED`; `reason` is
  required only when `decision` is `REJECTED`.** Neither is enforceable by request-shape
  validation alone, since which fields are mandatory depends on the value of another field
  — both are checked in `RecommendationService.decide`, the same way `ShiftService`
  checks `endsAt` after `startsAt` rather than leaning on annotations alone.
- **The draft is never overwritten.** `Recommendation.draftPlan` is what the agent
  produced and stays that way regardless of decision. An `EDITED` decision's final,
  approved mitigations live on the `Approval` (`editedPlan`) instead — the API response
  surfaces both, so "what did the supervisor change" is a diff a client can render, not
  something lost the moment a decision is made.
- **Mitigations reuse the existing `MitigationSuggestion` shape** (`priority`, `action`,
  `rationale`, `estimatedImpact`) from the SCRUM-187 Bedrock spike, rather than inventing a
  parallel one. `draftPlan`/`editedPlan` are stored as the same serialized
  `MitigationSuggestion.Batch` JSON Bedrock already returns; the service parses that JSON
  back into a real array for the API response rather than handing a client a string to
  parse itself.
- **Reading is broader than deciding.** `GET` is open to `SUPERVISOR`, `SAFETY_MANAGER`
  and `ADMIN`; the decision endpoint is `SUPERVISOR`/`ADMIN` only. This matches SCRUM-119's
  own framing — "As a Site Supervisor, I want to approve, edit or reject" — a safety
  manager's role here is oversight, not the decision itself.
- **Site- and shift-scoped the same way `ShiftController` is.** Nested under
  `/api/v1/sites/{siteId}/shifts/{shiftId}/recommendations`, `@PreAuthorize`d with
  `@siteAccess.canAccess(#siteId)` on every method, and every lookup scoped through the
  shift (`findByIdAndShiftId`) so a recommendation id from a different shift reads as 404
  rather than leaking across the boundary.
- **Every decision audits**, matching the `afterCommit`-deferred pattern SCRUM-160
  established (see that ticket's plan doc) so a decision that gets rolled back can never
  leave behind an audit row claiming it happened: `RECOMMENDATION_APPROVED`,
  `RECOMMENDATION_REJECTED`, `RECOMMENDATION_EDITED`.

## What was built

- `docs/api/recommendation.yaml` — new contract: `GET` list, `GET` one,
  `POST .../decision`. Schemas: `Recommendation`, `Approval`, `MitigationSuggestion`,
  `RecommendationDecisionRequest`.
- `RecommendationRepository.findByIdAndShiftId` — the shift-scoped lookup, mirroring
  `ShiftRepository.findByIdAndSiteId`.
- `RecommendationService` — list-for-shift, get-one, and `decide` (the one write path),
  plus the JSON parse/serialize between the stored plan text and `MitigationSuggestion`
  lists.
- `RecommendationController` — the three endpoints, site/shift-scoped and role-gated as
  above.
- `ConflictException` (`common/error/`) + a `GlobalExceptionHandler` handler — this
  codebase had `BadRequestException` (400) but nothing for "well-formed request, wrong
  state" (409) before now.
- `AuditEventType.RECOMMENDATION_APPROVED` / `_REJECTED` / `_EDITED`.
- `RecommendationControllerTest` — 16 cases: list/get happy path with mitigations parsed
  correctly, 404 across a wrong shift, unauthenticated 401, approve/reject/edit happy
  paths with audit assertions, reject-without-reason and edit-without-plan as 400,
  deciding twice as 409, decide-on-unknown as 404, and the three negative-role cases
  (safety manager, worker, cross-site supervisor) all 403.

## What this unblocks

`ActionDispatchService.dispatchAction` already requires an `Approval` with
`decision == APPROVED` before it will dispatch anything to a worker — until this ticket,
nothing in the codebase could produce that row outside a test. That existing, already-real
dispatch pipeline (SCRUM-185/186, already consumed by the mobile app) becomes usable
end-to-end once SCRUM-118 exists to create the `Recommendation` this ticket now lets a
supervisor act on.

## Dependencies

- **Depends on**: SCRUM-156 (site-scoping pattern), SCRUM-160 (shift domain, for the
  shift-scoping this nests under). Does *not* depend on SCRUM-118 being built — this PR
  seeds recommendations directly in tests.
- **Blocks**: nothing directly, but is the missing link between SCRUM-118 (once built) and
  the already-real SCRUM-185/186 dispatch pipeline.

## Verification

Full backend suite: 178/178 passing, no regressions.
