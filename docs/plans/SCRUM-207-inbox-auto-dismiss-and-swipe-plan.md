# SCRUM-207 — Inbox auto-dismiss and swipe-to-clear plan

## Outcome

Acknowledged actions leave the inbox on their own. A rest card leaves when the rest is
served (SCRUM-206); every other acknowledged card leaves three minutes after the
acknowledgement lands. A worker who wants it gone sooner can swipe it away.

The result the worker sees is an inbox that reflects what they still owe, rather than a
growing archive of things they have already done.

## Depends on SCRUM-206

SCRUM-206 introduces the deadline field on the acknowledgement record, the per-card clock and
the removal path. SCRUM-207 supplies a different deadline for non-rest codes and adds a second
way to reach the same removal. **If this is built first, the two features grow separate
timers and separate expiry rules, and reconciling them later costs more than sequencing them
now.**

One mechanism, two sources for the deadline:

| Action | Deadline |
| --- | --- |
| `REST_(\d+)_MIN` | acknowledgement + the parsed duration (SCRUM-206) |
| Everything else | acknowledgement + 3 minutes |
| Swipe, any acknowledged card | immediate |

## Why three minutes is a constant here and not a policy value

It is a UI dwell time — how long a confirmation stays on screen — not a safety rule. It does
not belong in the policy engine, it is not FR-derived, and it must not read as though it
were: nothing about the worker's obligation changes at three minutes. Naming it as a constant
with that reasoning attached is the point, so nobody later mistakes it for something the
backend should own.

## The gesture

`Swipeable` from `react-native-gesture-handler` 2.32, which is already a dependency and
already has `GestureHandlerRootView` mounted at the app root in `App.tsx`.

Deliberately **not** `ReanimatedSwipeable`: `react-native-reanimated` is not installed, and
adding it is a native dependency on a project that has never produced an EAS build. The
legacy `Swipeable` runs on RN `Animated`, which is what `AnimatedIcon` already uses.

Rules:

- **Only an acknowledged card can be swiped.** A pending action is an instruction the worker
  still owes and the supervisor has not been told about; letting it be flicked away would
  make the inbox lie about what is outstanding. This is the same reason the progress bar
  waits for a successful acknowledgement.
- Either direction. A worker in gloves on a hot site should not have to remember which way.
- The swipe removes the card from the list only. The persisted acknowledgement record is
  untouched, so idempotent replay (SCRUM-186) and SCRUM-130's queue are unaffected.

## Risks worth naming

**Swiping and virtualisation.** `Swipeable` inside a `FlatList` cell is a known source of
gesture conflicts with the list's own scroll, and this list has already produced one
Android-only rendering bug (README Problem 10). Verify on more than one device geometry and
against the longest translated labels, not just English.

**A gesture with no affordance is a gesture nobody finds.** Swipe must stay a shortcut, never
the only route. Auto-dismiss is what actually clears the list; the swipe only makes it sooner.
That ordering is what keeps the feature honest for a worker who never discovers it.

**Accidental dismissal.** Low cost by construction — the action is already acknowledged, so
nothing is lost but a receipt. No undo is planned. If review disagrees, the cheap version is
a brief undo affordance on the toast that already exists at the app root, not a confirmation
dialog: SCRUM-186 argues against a confirm step on this screen, and that argument still holds.

## Behaviour

| State | Swipe | Auto-dismiss |
| --- | --- | --- |
| Pending | Blocked | No |
| Acknowledgement in flight | Blocked | No |
| Acknowledgement failed | Blocked | No — the card must stay so it can be retried |
| Acknowledged, `REST_*` | Allowed | At the rest deadline (SCRUM-206) |
| Acknowledged, any other code | Allowed | At acknowledgement + 3 minutes |

A failed acknowledgement is the case most easily got wrong. The card must remain and stay
un-swipeable, because the worker still owes the action and the retry lives on that card.

## Acceptance

- A `HYDRATE` card acknowledged at 07:48 disappears at 07:51 with no interaction, and does
  not return on the next poll.
- A `REST_15_MIN` card ignores the 3-minute rule and uses its own deadline.
- Swiping a pending card does nothing and does not move it.
- Swiping an acknowledged card removes it immediately, in either direction.
- A card whose acknowledgement failed cannot be swiped and does not auto-dismiss.
- Killing the app with a card mid-dwell and relaunching honours the original deadline.
- The list still scrolls normally with a swipe partially open.
- Verified on at least two device geometries and in a non-Latin language.

## Out of scope

Undo. Any change to what is persisted. Any backend change — the deadline is derived
client-side from the acknowledgement the client already recorded.
