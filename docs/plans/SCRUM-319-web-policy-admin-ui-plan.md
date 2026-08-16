# SCRUM-319 — Web policy admin UI (config + versioning) plan

## Outcome

The web console gains a "Heat Policy" screen: any signed-in SUPERVISOR, SAFETY_MANAGER or
ADMIN can see a site's policy version catalogue (source, effective date, status, all nine WBGT
thresholds and the emergency stop), and a SAFETY_MANAGER/ADMIN can configure a new version and
activate a DRAFT one. Built against `PolicyVersionController`
(`backend/src/main/java/com/crewsafe/policy/api/PolicyVersionController.java`), which SCRUM-309
already shipped — list/active/create/activate under `/api/v1/sites/{siteId}/policy-versions`,
role-gated the same way this UI gates its routes. This is the web counterpart to SCRUM-338–342,
which shipped the same feature on mobile against PR #189.

`web/src/features` gains a fifth real feature (`policy`), alongside `shifts` and `conditions`.

## Approved design

- **Site resolution originally mirrored `ConditionsPage.tsx`** (`user.siteIds[0]`), reasoning
  that policy, like conditions, is a per-site configuration screen rather than a cross-site
  action, so there was no scenario needing to switch between sites' policies in one view. That
  premise was wrong: a Safety Manager or Supervisor assigned to more than one site (a real,
  confirmed account shape) was silently locked to whichever site happened to be first in
  `siteIds`, with no indication of which site was shown and no way to reach the other —
  `ConditionsPage.tsx` had the identical defect. Both screens now read a shared, session-scoped
  selection via `useSelectedSite()` (`web/src/site/`), seeded from `user.siteIds[0]` and
  persisted per-tab in `sessionStorage`, switchable through `<SitePicker>` — shown only when
  the user has more than one site, otherwise the single site's name is shown as plain text so
  it's never ambiguous. This is **not** `CreateShiftForm`'s local, unpersisted dropdown: the
  selection is shared across `/conditions`, `/policy` and `/policy/new` (and seeds
  `CreateShiftForm`'s own default), and — matching ADR-0015's reasoning — the selected
  `siteId` is never placed in a URL or route param, only in React context and
  `sessionStorage`, so the CSPT surface that ADR avoided by resolving `siteId` from
  `/api/v1/me` is not reopened by adding a switcher.
- **Routing is additive, flat, and role-mirrored from the backend.** `/policy` reuses the
  existing `MANAGEMENT_ROLES` constant (`web/src/app/routeAccess.ts`) — the same
  SUPERVISOR+SAFETY_MANAGER+ADMIN set `PolicyVersionController`'s read endpoints allow.
  `/policy/new` gets a new `SAFETY_MANAGER`/`ADMIN`-only entry, matching the controller's
  create/activate gate. Nothing existing in `routeAccess.ts`, `navigation.ts` or `App.tsx` was
  changed in place — see [ADR-0015](../adr/0015-flat-routing-site-scoped-screens.md), which this
  follows rather than revisits.
- **The create form pre-fills only the nine thresholds and the emergency stop** from
  `fetchActivePolicyVersion`, leaving label, source, effective date and notes blank. Carried
  over from the mobile design (SCRUM-340): a real policy revision is a tweak to a handful of
  numbers, not a reason to retype nine unchanged thresholds — and pre-filling the label would
  collide with the server's per-site uniqueness constraint on `versionLabel` in the ordinary
  case of two versions sharing everything but a threshold.
- **`effectiveDate` is a native `<input type="date">`**, not `react-datepicker` in
  `CreateShiftForm`'s datetime mode — the API field is `LocalDate`, and datetime mode would
  invent a time component the server neither wants nor stores.
- **No native HTML `required`/`min`/`max` on the custom-validated fields.** These were tried
  first and reverted: jsdom's real form-submission constraint validation silently blocks the
  `submit` event (and therefore `handleSubmit`) before React ever sees it, which meant the
  custom messages `validatePolicyVersion.ts` was built to show — "Must be at least 15°C.",
  "Enter an effective date." — could never actually render. Given every one of these fields has
  a purpose-written message (mirroring the ticket's own bar: "a 400 is unreachable in normal
  use"), the form relies on `validatePolicyVersion` as the single, visible source of truth
  instead of half-relying on a browser tooltip that would otherwise win the race silently.
- **Activation confirmation is an inline disclosure, not a modal.** There is no modal/dialog
  component anywhere in `web/src` yet, so `PolicyVersionCard` follows the same
  open/closed-toggle style `ShiftCard.tsx` already uses for its crew table, naming both the
  version being activated and the one it supersedes before a second click confirms — matching
  the mobile AC (SCRUM-341) without introducing a new UI primitive for one screen.
- **Activating refetches the whole catalogue** rather than patching state locally. Simpler than
  reproducing the server's supersede-then-activate transition in the client, and the catalogue
  is small enough that a refetch is not noticeable.
- **Status pills reuse `--status-ok`/`--status-waiting`/`--status-none`** — the same tokens
  `ShiftList.css` maps to PLANNED/ACTIVE/CLOSED — rather than inventing new hazard-scale colours
  for what is a workflow state, not a WBGT reading.

## Known limitations

- **No i18n.** Mobile ships every policy string in seven locales (SCRUM-339); the web app has no
  i18n layer at all yet (checked — no `i18next` or equivalent anywhere in `web/src`), so this
  screen is English-only like every other web screen today. Not a regression specific to this
  ticket.
- **The activate confirmation is a plain inline disclosure**, not a true modal — acceptable here
  because nothing else on the page changes underneath it, but the pattern doesn't obviously
  generalise to a screen where it would.
