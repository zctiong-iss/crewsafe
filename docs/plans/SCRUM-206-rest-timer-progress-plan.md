# SCRUM-206 — Rest timer and progress bar plan

## Outcome

A worker who acknowledges a rest instruction gets a visible countdown of the rest they owe,
and the card removes itself when the rest is served. Nothing to dismiss, nothing to
remember, no second interaction.

The bar appears only after the acknowledgement has succeeded server-side. Before that the
card looks exactly as it does today. An action the supervisor has not been told about must
not look like an action in progress.

## Scope boundary

SCRUM-206 introduces the shared dismissal mechanism and uses it for `REST_*` actions only.
[SCRUM-207](SCRUM-207-inbox-auto-dismiss-and-swipe-plan.md) extends the same mechanism to
every other action code and adds the swipe gesture. The two are deliberately sequenced:
building one timer with one expiry path is a smaller and more testable change than building
two systems that later have to be reconciled.

## The duration comes from the action code, never from the title

The rest length is already carried structurally. `ActionDispatch.actionCode` is an open
catalogue (`REST_10_MIN`, `REST_15_MIN`, `HYDRATE`, `STOP_WORK`, `ROTATE_TO_LIGHT_DUTY`),
and `startTime` / `endTime` exist on the same record.

Resolution order:

1. **`endTime`**, if the server sent one. It is the server's own answer and outranks anything
   the client can derive.
2. **`REST_(\d+)_MIN` parsed from `actionCode`**, measured from the acknowledgement time.
3. **No bar.** An unrecognised code gets the card exactly as it renders today.

The rendered title is explicitly **not** a source. It is a translated string: Tamil renders
`15 நிமிடம் ஓய்வெடுங்கள்`, Burmese `၁၅ မိနစ် အနားယူပါ` with Burmese numerals. A regex over it
would work in English and fail in six of the seven shipped languages, and would break again
the first time a translator rewords a sentence. The catalogue is open-ended by design
(`V3__domain_schema.sql` says so), so tolerating an unparseable code is a requirement rather
than a defensive nicety.

## State and durability

The acknowledgement record in `dispatchInboxSlice` is already persisted and already carries
`acknowledgedAt`. SCRUM-206 adds a derived deadline to it, so a rest survives the app being
killed — which on a site phone is not an edge case.

Wall-clock, not elapsed-since-mount. A monotonic timer cannot survive a process death, and
the process dying mid-rest is exactly the case that must not restart a fifteen-minute rest
from zero. The accepted cost is that changing the device clock can end a rest early. That is
documented rather than defended against: the threat model is a worker skipping a rest, their
supervisor can already see the acknowledgement, and clock-tamper detection would be more code
and more edge cases than the risk earns.

`useNow` already exists and ticks a component once a second without re-rendering the tree
above it. It is used per card, not at the list, so a running timer redraws one card.

## Motion

The bar is **essential motion**: exempt from the in-app Reduce Motion preference, still
stopped by the OS-level setting. This is the carve-out `AnimatedIcon`'s `essential` prop
already defines for the stop-work pulse, and the reasoning transfers — SCRUM-199 made the
in-app preference default to *on*, so without an exemption the bar would be frozen for every
worker who has never opened Settings, and a progress bar that does not progress is a broken
feature rather than a calmer one.

A numeric remaining-time label renders alongside the bar in every case. It carries the same
information for anyone whose OS setting suppresses the animation, for a screen-reader user,
and for anyone who simply prefers a number — so the animation is the pleasant version of the
truth, never the only copy of it.

## Behaviour

| State | Card |
| --- | --- |
| Pending | As today. No bar. |
| Acknowledgement in flight | As today. No bar — the server has not confirmed. |
| Acknowledged, rest running | Acknowledged state, progress bar, remaining time |
| Deadline reached | Card removes itself from the list, no interaction |
| Acknowledged, no resolvable duration | Acknowledged state, no bar, no auto-dismiss |

Removal is from the rendered list only. The persisted acknowledgement record stays, because
it is what makes a replayed acknowledgement idempotent (SCRUM-186) and what SCRUM-130 will
build its queue on.

## Acceptance

- Acknowledging `REST_15_MIN` shows a bar that fills over fifteen minutes and a remaining
  count that agrees with it.
- `REST_10_MIN` fills over ten. The two differ without a code change.
- The bar does not appear before acknowledgement, nor while the request is in flight, nor if
  the request fails.
- Killing the app mid-rest and relaunching resumes the same deadline, not a fresh one.
- At the deadline the card disappears with no interaction, and does not return on the next
  poll.
- An action code with no derivable duration renders exactly as it does today.
- With OS Reduce Motion on, the bar does not animate and the numeric count still updates.
- Verified in a non-Latin language, because the duration must not come from the title.

## Out of scope

The 3-minute rule and the swipe gesture (SCRUM-207). Offline queueing (SCRUM-130). Any
backend change: this is derivable from fields the contract already has, and adding an
explicit duration to `ActionDispatchController` would be a better contract but would block
delivery on work outside the mobile app.
