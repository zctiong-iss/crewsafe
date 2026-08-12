# SCRUM-120 (mobile) — Safety manager configures and versions the active heat policy

US-24. React Native only — the React web console is explicitly out of scope for this ticket.

## Starting state

**The backend is done and merged** ([PR #189](https://github.com/zctiong-iss/crewsafe/pull/189)).
`policy_version` replaced the old single-mutable-row-per-site table, versions carry a source and
an effective date, exactly one is `ACTIVE` per site, and recommendations now cite the real active
version instead of the hardcoded `"MOM-WBGT-2026.1"` literal that used to sit in
`PolicyEngineService`. 407 backend tests pass.

Nothing in the mobile app calls any of it. This ticket is the mobile half.

### The contract this must consume

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/v1/sites/{siteId}/policy-versions` | `SUPERVISOR`, `SAFETY_MANAGER`, `ADMIN` |
| `GET` | `/api/v1/sites/{siteId}/policy-versions/active` | `SUPERVISOR`, `SAFETY_MANAGER`, `ADMIN` |
| `POST` | `/api/v1/sites/{siteId}/policy-versions` | **`SAFETY_MANAGER`, `ADMIN`** |
| `POST` | `/api/v1/sites/{siteId}/policy-versions/{id}/activate` | **`SAFETY_MANAGER`, `ADMIN`** |

Reading is broader than writing, so one screen serves two capability levels. The first version a
site gets auto-activates; every later one is created `DRAFT` and needs explicit activation.

## Three mobile-side constraints found while scoping

1. **A safety manager has no tab set of their own.** `RootNavigator` routes `SUPERVISOR`,
   `SAFETY_MANAGER` and `ADMIN` to the same `SupervisorTabs`, which is already five tabs after
   US-11. A sixth is past what a bottom bar carries comfortably, and it would show supervisors a
   tab they can read but not act in.
2. **`effectiveDate` is a `LocalDate`.** `AppDateTimeField` is `mode="datetime"` and would invent
   a time component the server neither wants nor stores.
3. **A version carries 13 fields.** Nine thresholds, an emergency stop, a label, a source and a
   date — a punishing form on a handset, and nine of those numbers are usually unchanged.

## Approved design

- **Profile → Heat policy, gated to `SAFETY_MANAGER`/`ADMIN` for writes.** Configuration is rare
  and administrative; it does not deserve permanent tab-bar space, and this is where Settings
  already lives for the same reason.
- **New versions clone the active one.** A real MOM revision tweaks two or three numbers; making
  someone retype nine unchanged thresholds is where a transcription error enters a safety rule. A
  blank form stays reachable for a site's first version.
- **Supervisors get the read view, and the recommendation links to it.** The `GET` is already
  authorized for them, and it turns "recommendations cite version" from a string in a database
  into something a human can follow. That is the acceptance criterion actually being met.
- **Activation names what it supersedes.** Switching the active version silently changes the rules
  an entire site is judged against. There is no un-activate endpoint, so the confirmation says
  which version is being retired rather than asking a generic "are you sure".
- **Client validation mirrors the server exactly** — thresholds `>= 15`, emergency stop `20..40`,
  label `<= 64`, source `<= 255` — so a 400 is unreachable in normal use, the same standard
  `CreateShiftScreen` holds itself to.

## Sub-tasks

| # | Sub-task | Why it is its own piece |
|---|---|---|
| 1 | Policy version types, API client and mock fixtures | Everything else depends on it; nothing is demonstrable without fixtures, since a fresh site has one auto-activated version and no history |
| 2 | Catalogue and version detail screens (read) | The read half is useful on its own and is all a supervisor ever gets |
| 3 | Create a version by cloning the active one | The largest piece, and the one carrying the date-only field and the mirrored validation |
| 4 | Activate a version, naming what it supersedes | Small but distinct: the only destructive-ish action, and the only one with no undo |
| 5 | Link a recommendation's cited version to its detail | Closes the traceability half of the acceptance criteria; touches the SCRUM-119 screen rather than this one |

## Out of scope

- The React web console. Named in the story's implementation technologies, explicitly excluded
  here.
- Editing a `DRAFT` in place. The server has no update endpoint; a wrong draft is superseded by a
  new one.
- Un-activating. No endpoint, and reverting means activating the previous version again — which
  leaves two activation events for one mistake, correctly.
- Per-site policy for a manager who belongs to several sites: the screen follows the same selected
  site the shift screens use rather than introducing a second site picker.
