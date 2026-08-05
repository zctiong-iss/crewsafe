# SCRUM-209 — Rest swipe fix, live weather, and animated condition backgrounds

Three pieces of work in one ticket. They are unrelated in mechanism and share only a release:
a regression fix in the Alerts list, replacing simulated weather with the readings the backend
already ingests, and giving the Weather hero card a backdrop that reflects the condition.

Parts 2 and 3 both touch the Weather screen, so they are sequenced together — but Part 3
depends on nothing in Part 2 and can ship first if the backend band work runs long.

---

## Part 1 — A rest cannot be swiped away while it is running

### The defect

Acknowledging a `REST_*` action starts its countdown, and the card can still be swiped off the
list before the countdown finishes. The rest is then neither served nor visible.

Introduced by SCRUM-207. `InboxScreen` enables the gesture for anything acknowledged:

```tsx
enabled={Boolean(acknowledged[item.id]) && !inFlight.includes(item.id)}
```

The SCRUM-207 plan justified the swipe as a way to "make it sooner", which is right for a
three-minute dwell — that dwell is only a confirmation lingering on screen. It is wrong for a
rest. The countdown is not a dwell: it is the rest itself, and the card disappearing is how the
worker knows it is over. A gesture that removes it early removes the only thing tracking a
safety obligation, and does so silently.

### The rule

An acknowledged card is swipeable **unless it has a rest timer that has not yet expired.**

| Card state | Swipe |
| --- | --- |
| Pending | blocked (unchanged) |
| Acknowledgement in flight | blocked (unchanged) |
| Acknowledgement failed | blocked (unchanged) |
| Acknowledged, three-minute dwell | allowed (unchanged) |
| **Acknowledged, rest timer running** | **blocked — new** |
| Acknowledged, rest timer already expired | allowed |

The last row matters for the case where the deadline passed while the app was closed. The card
is dismissed on mount by its own timer, but between mount and that firing it must not be stuck.

`hasRestTimer` and `dismissAt` are both already on the acknowledgement record, so the condition
is derivable where the gesture is configured. No new state.

### Behaviour

Nothing happens. The card does not move, exactly as a pending card does not move today. The
countdown already on screen is the explanation; a worker who can see `12:47 left` does not need
to be told why the card will not go.

### Acceptance

- Acknowledge a `REST_15_MIN`, swipe either direction: the card does not move and is not
  removed.
- The same card auto-disappears when the countdown reaches zero, with no interaction.
- A `HYDRATE` card remains swipeable immediately after acknowledgement.
- A rest whose deadline has already passed (app reopened after the window) can be swiped, and
  is dismissed on its own regardless.
- Regression test at the selector/props level so this cannot be reintroduced silently.

---

## Part 2 — Live weather from the ingestion API

### What already exists

`GET /api/v1/sites/{siteId}/weather/latest` — `WeatherController`, site-scoped with the same
`@PreAuthorize("@siteAccess.canAccess(#siteId)")` as `SiteController`. It returns the stored
observation rather than calling data.gov.sg during the request.

Its response maps almost one-to-one onto mobile's `SiteConditions`:

| API field | `SiteConditions` |
| --- | --- |
| `siteId`, `wbgt`, `temperature`, `humidity`, `windSpeed`, `rainfall` | same names |
| `observedAt`, `ingestedAt`, `source`, `qualityStatus`, `stationId` | same names |
| `id` | not needed by the app |

**The mobile code's own TODO is out of date.** `api/endpoints/safety.ts` says the endpoint does
not exist and names `/api/v1/sites/{siteId}/conditions`; the real one shipped at
`/weather/latest`. Correcting that comment is part of this work — a stale "not implemented"
note is how a team builds a second mock for something it already has.

### What does not exist, and what that forces

The endpoint returns **an observation only**. There is no WBGT band, and no policy evaluation
anywhere in the backend — all six controllers were checked.

The Weather screen currently renders `32 to 33°C` from `policy.currentBand`, produced by the
*mock* policy engine in `api/mock/conditions.ts`. The client cannot simply compute it: §12.2
states no client may submit or override a WBGT risk band, and that mock file says in terms that
the band arithmetic must not become a helper the UI can import, because a screen would
eventually call it and the app would be deciding safety policy in a second place that drifts
from the first.

**So the backend must expose the band before the mobile switch can be complete**, and this
ticket carries both halves:

1. **Backend** — extend the weather response (or add a sibling endpoint) with the evaluated
   band, so the policy engine stays authoritative per FR-15.
2. **Mobile** — consume the live observation and the live band together.

Sequenced that way. Mobile can be written against the extended contract before it lands, but
must not merge ahead of it, or the Weather screen loses information that is on screen today.

### Scope of "live"

The real call goes into `api/endpoints/safety.ts` behind the existing `isMockApi()` split, the
same shape every other endpoint in the app already uses. **Mock mode keeps its mocks** — that is
the offline demo path, and the only way the app runs without a reachable backend and valid
Cognito credentials.

`api/mock/conditions.ts` therefore stays. Its header already says to delete it when the endpoint
lands; that instruction now applies only to the half the backend covers, and the file's comment
should be corrected rather than the file removed.

### Presentation does not change

No theme, font, layout or copy changes. Every view renders the same fields it renders today,
from a different source. Specifically:

- **Heat conditions card** (`WbgtCard`) — the reading and the freshness badge. Already stripped
  to that by SCRUM-196, so it needs the observation only.
- **Weather screen** — condition icon, WBGT, band, air temperature, humidity, wind, rainfall,
  station, observed/received times, and the freshness notice.
- **Freshness stops being decorative.** `qualityStatus` becomes the real ingestion's answer, so
  `LIVE` / `DELAYED` / `STALE` start meaning what FR-12 says they mean, and the `SIMULATED`
  badge stops appearing in Cognito modes. That is the single most valuable part of this change
  and the one most likely to be mistaken for a regression in review.

### Risks

**The observation may be absent.** The controller returns 404 when a site has no stored
reading — a new site, or ingestion not yet run. That is not an error state to shout about; the
screen already has a "no reading available" path and should use it.

**The ingestion must actually be running.** `WeatherIngestionScheduler` writes the rows this
endpoint reads. If it is not scheduled in the target environment the endpoint returns 404
forever and the app looks broken with no clue why. Verify ingestion has run before verifying the
screen.

**`FixtureNeaWeatherClient` exists.** Some environments ingest fixture data rather than real NEA
readings. "Live" here means "from the API", not "necessarily from NEA" — worth stating so nobody
concludes the wiring failed when a fixture value appears.

### Acceptance

- Weather and My shift render from the API in a Cognito mode, with no visual change.
- Mock mode is untouched and still runs with no backend.
- `qualityStatus` reflects the real ingestion; the `SIMULATED` badge no longer appears live.
- A site with no observation shows the existing empty state, not an error.
- The stale TODO in `api/endpoints/safety.ts` is corrected.
- Verified on two device geometries and in a non-Latin language.

---

## Part 3 — A condition backdrop on the Weather hero card

### Outcome

The Weather screen's hero card gains a background that reflects the current condition — rain
falling, cloud drifting, sun turning — in the spirit of a consumer weather app. Backgrounds are
**swappable by design**: replacing one is adding a file and a map entry, not editing a
component.

### The swap mechanism, which already has a documented shape

`WeatherIcon.tsx` describes the pattern for its own icons, and Part 3 reuses it rather than
inventing a second one:

1. Assets live in `src/assets/animations/`.
2. A `Record<string, ...>` keyed by `` `${condition}${night ? "-night" : ""}` `` — the string
   the weather code already computes.
3. A hit renders the asset; a miss falls through to the default. **A missing entry must render
   the plain card, never an empty box** — a blank frame looks like a broken asset rather than an
   unfinished registry, which is the same reason `WeatherIcon` refuses to ship a stub branch.
4. A `.web.tsx` sibling if Lottie is used: `lottie-react-native`'s web entry breaks the web
   bundle, which is why `LottieSpinner.web.tsx` exists.

Six conditions — `FAIR`, `PARTLY_CLOUDY`, `CLOUDY`, `WINDY`, `RAIN`, `THUNDERY_SHOWERS` — plus
optional night variants, so up to twelve keys.

### What ships now: the mechanism and a coded default

No designed artwork is commissioned by this ticket. What ships is the registry, the fallback
behaviour, and a lightweight backdrop per condition built with the `Animated` API already used
by `AnimatedIcon` — no new dependency, no new assets, no licensing question.

That ordering is the point of the request. Once the registry exists, dropping in designed
Lottie files later is a file and a map entry, and the decision about whether a given animation
"fits the background card" becomes reversible in one line.

### Reduce Motion: this one is decorative, and must behave like it

The stop-work pulse and the rest progress bar are exempt from the in-app Reduce Motion
preference because their motion *carries information* — urgency in one case, time remaining in
the other. **A condition backdrop carries none.** The icon and the label already say "Rain";
the animation is atmosphere.

So it respects the preference in full, with no `essential` carve-out. Using that exemption here
would weaken the argument protecting the stop-work pulse, which is the one place it genuinely
matters.

Because SCRUM-199 makes the preference default to **on**, that means most workers will never
see the motion — so every condition ships a **still** state as well: a static frame or gradient
that makes the card look designed rather than merely unanimated. The animation is the
enhancement; the still is the feature.

| Setting | Hero card |
| --- | --- |
| Motion allowed | animated backdrop |
| Reduce Motion (in-app or OS) | still backdrop for the same condition |
| High contrast | no backdrop at all — plain surface |

### High contrast removes the backdrop entirely

High contrast exists so a worker can read the screen in direct sun. The hero card carries the
WBGT reading at `display` size plus four labels, and putting illustration behind them defeats
the one mode that makes them legible. In high contrast the card renders exactly as it does
today.

This is not a compromise to revisit later. Any backdrop that survives a contrast check against
every text colour on the card would be so heavily scrimmed that it is no longer the thing that
was asked for.

### Scope

The **Weather hero card only**. The Heat conditions card on My shift was deliberately stripped
to a single reading in SCRUM-196, and putting decoration behind a safety number on the worker's
main screen would reverse that with no discussion.

Nothing else on the card changes: same fields, same fonts, same layout, same copy.

### Risks

**Legibility is the whole risk.** Every text colour on that card must still pass AA against the
busiest frame of each backdrop, not the calmest — a light rain animation with a bright flash is
readable for 90% of its loop and not for the rest. Check the worst frame.

**Battery and frame budget.** A looping full-card animation runs the whole time the screen is
open, on a phone that has to last an outdoor shift. It should stop when the screen is not
focused, the way the polls already do.

**Bundle size** if Lottie assets land later: twelve JSON files is not free, and every one ships
to every worker regardless of the weather they will see.

### Acceptance

- Each of the six conditions renders its own backdrop; night variants where provided.
- An unmapped condition renders the plain card, with no empty box and no error.
- Reduce Motion (in-app or OS) shows the still backdrop, not a frozen animation and not nothing.
- High contrast shows no backdrop.
- Every label and the WBGT reading pass AA against the busiest frame of every backdrop.
- The animation stops when the Weather screen is not focused.
- Swapping one condition's backdrop is a one-line change, demonstrated in review.
- Verified on two device geometries and in a non-Latin language.

---

## Out of scope

Lightning (`GET /sites/{siteId}/lightning`) remains unimplemented server-side, so the stop-work
banner stays mocked and its `SIMULATED` marker stays honest. The heat guidance card is still
behind `features.heatGuidanceCard`; if the band lands, revisiting that flag is its own decision.

Commissioning or licensing designed animation assets. Part 3 delivers the mechanism and a coded
default; sourcing artwork — including checking the licence on anything taken from LottieFiles —
is separate work with a different kind of decision in it.
