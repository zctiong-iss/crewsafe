# SCRUM-208 — Alerts rename and unacknowledged badge plan

## Outcome

The Inbox becomes Alerts, and its tab icon carries a live count of the actions the worker
still owes. Three unacknowledged actions show `3`; acknowledging one shows `2`; acknowledging
the last drops the number entirely and the bell changes to a checked variant, so "you are up
to date" is stated rather than merely implied by an absence.

The point is what the worker learns without opening anything. A badge that is only correct
once you are already looking at the screen it points to has told you nothing.

## Rename

`tabs.inbox` becomes `tabs.alerts`, valued "Alerts" in all seven locales. One key drives both
the tab label and the stack header (`stacks.tsx` and `WorkerTabs.tsx` both read it), so the
two cannot drift.

Deliberately **not** renamed: `InboxScreen.tsx`, the `inbox.*` translation block,
`dispatchInboxSlice`, `dispatchInboxPersistConfig`, `api/endpoints/dispatch.ts`. Those track
the API concept — `GET /api/action-dispatch/worker/{id}/pending` is an inbox of dispatched
actions — not the label a worker reads. Renaming them would produce a large diff across many
files that buries the actual behaviour change, and would leave the code further from the
endpoint it mirrors rather than closer.

## The count

**Unacknowledged = an item in the rendered list with no acknowledgement record.**

```
count = items.filter((item) => !acknowledged[item.id]).length
```

Three consequences, each deliberate:

- **A failed acknowledgement still counts.** The action is owed until the server says
  otherwise, and the card keeps its retry button.
- **An in-flight acknowledgement still counts.** It stops counting when the server confirms,
  not when the button is pressed. The badge must not report work the supervisor has not been
  told about.
- **A rest in progress does *not* count.** The record is written the moment the server
  confirms, and the running timer is a separate concern. This is the behaviour asked for and
  it needs no special case — writing one would be the way to get it wrong.

Dismissed cards leave `items` entirely (SCRUM-207), so they cannot be counted either way.

The count must be derived in the **tab navigator** from the store, not inside `InboxScreen`.
The badge is drawn on a tab that is visible while other screens are in front, so a value
owned by the screen would be stale exactly when it matters.

## Making the badge honest — the poll has to move

`useAutoRefresh` is `useFocusEffect`-based: the inbox poll runs only while the Inbox screen is
focused. Its own comment justifies that on battery, and that reasoning is sound for a screen's
own data.

It is not sound for a badge. A tab badge exists to report what arrived **while the worker was
somewhere else**, so under the current arrangement a new dispatch would not move the count
until the worker opened the very screen the badge was meant to send them to. The NFR is
already "visible to an online worker within 60 seconds", and focus-gated polling cannot meet
that from another tab.

So the dispatch poll moves up to the worker tab tree and runs while any worker tab is mounted.
The battery cost is real and is accepted here, for one screen's data, because the alternative
is a feature that cannot do the job it exists for. It stays foreground-aware: nothing polls
while the app is backgrounded.

**Scope note:** this changes when `loadInbox` runs, not what it does. The weather and shift
polls stay focus-gated — neither drives anything visible from another screen.

## Icon states

| State | Icon | Badge |
| --- | --- | --- |
| One or more unacknowledged | bell | the count |
| All acknowledged, cards still on screen | bell with a tick | none |
| List empty | bell | none |
| Never loaded / error | bell | none |

"All acknowledged" is a short-lived confirmation by design — SCRUM-207 clears those cards
after their dwell, so the checked bell lasts at most three minutes and then the list is empty
and the icon returns to neutral. That is the intended shape: it confirms what the worker just
did, and stops claiming anything once there is nothing to be up to date about.

An empty list deliberately gets the plain bell rather than the checked one. "Nothing has
arrived" and "you have dealt with everything" are different facts, and only the second is
worth a tick.

## Accessibility

The count must not be carried by the badge alone. `tabBarAccessibilityLabel` states it in
words — "Alerts, 2 unacknowledged" — so a screen-reader user gets what a sighted user gets
from the number. The checked state likewise reads as "Alerts, all acknowledged".

A small numeral on a tab icon is exactly the kind of detail that disappears in glare, which is
the operating condition this app is built for. The badge is the fast version; the label is the
one that always works.

## Acceptance

- Tab label and header both read "Alerts", in all seven languages.
- Three unacknowledged actions show `3`; acknowledging one shows `2`; acknowledging the last
  removes the number and shows the checked bell.
- Acknowledging a `REST_*` action decrements immediately, while its timer is still running.
- A failed acknowledgement does **not** decrement; retrying successfully does.
- The badge updates while the worker is on another tab, within the 60-second NFR.
- An emptied list shows the plain bell with no badge.
- Screen reader announces the count and the all-acknowledged state.
- Verified on two device geometries and in a non-Latin language — a badge is a layout element
  and Burmese numerals render differently from ASCII.

## Out of scope

Push notifications. Any badge on the app icon itself. Any backend change: the count is derived
from data the client already holds. Renaming the inbox slice, screen or translation block.
