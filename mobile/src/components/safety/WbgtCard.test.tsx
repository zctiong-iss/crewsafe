/**
 * The stop-work override on the Heat conditions card (SCRUM-260).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────
 * FR-12a requires that a lightning stop-work visibly override the heat plan until cleared.
 * With `features.heatGuidanceCard` off, this card's override line is the **only** place the
 * app says so in words — `mobile/README.md` records that and warns against removing it.
 *
 * That makes it the rare piece of UI whose absence is invisible. Delete the line and nothing
 * looks broken: the card renders, the reading is correct, the screen is tidy, and the app has
 * silently stopped meeting a safety requirement. A test is the only thing standing between a
 * tidy-up and that outcome.
 *
 * SCRUM-260 also removed the 45% dim. The card must now render identically whether or not a
 * stop-work is in force, apart from this one line — so that is asserted too, in both
 * directions, because "make it clearer during a stop-work" is exactly the well-meaning change
 * that would put the dim back.
 *
 * @author Justin Chua
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({ useTheme: () => mockTheme() }));
// `i18n.language` is read by `AppText`, which picks a font family and a line-height boost
// from it — so the mock has to supply it, not just `t`.
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import WbgtCard from "./WbgtCard";
import type { SiteConditions } from "@/types/domain";

const mockTheme = jest.fn();

/** Only the fields this component reads. */
function theme(highContrast = false) {
  return {
    highContrast,
    metrics: { radius: 12, borderWidth: highContrast ? 2 : 1 },
    colors: { surface: "#FFFFFF", border: "#DDDDDD" },
  };
}

function conditions(overrides: Partial<SiteConditions> = {}): SiteConditions {
  return {
    siteId: "s1",
    wbgt: 31.4,
    temperature: 33,
    humidity: 75,
    windSpeed: 5,
    rainfall: 0,
    observedAt: "2026-08-06T02:00:00Z",
    ingestedAt: "2026-08-06T02:01:00Z",
    source: "NEA",
    qualityStatus: "LIVE",
    stationId: "S128",
    ...overrides,
  } as SiteConditions;
}

/** The card's outermost View, which is where opacity would be applied. */
function rootStyle(json: unknown): Record<string, unknown> {
  const root = json as { props?: { style?: unknown } };
  const style = root?.props?.style;
  return Object.assign({}, ...(Array.isArray(style) ? style : [style]).filter(Boolean));
}

beforeEach(() => {
  mockTheme.mockReturnValue(theme());
});

describe("the FR-12a override", () => {
  it("states the override in words while a stop-work is in force", async () => {
    const { queryByText } = await render(<WbgtCard conditions={conditions()} superseded />);

    // The key, not the copy: this guards that the line renders at all. Changing the wording
    // is a product decision; removing the line is a safety regression.
    expect(queryByText("wbgt.stopWorkOverride")).not.toBeNull();
  });

  it("says nothing about an override when no stop-work is in force", async () => {
    const { queryByText } = await render(<WbgtCard conditions={conditions()} />);

    // Just as important as the line appearing. An override shown during Clear or Advisory
    // would tell a worker to shelter when nothing is wrong, and the next one gets ignored.
    expect(queryByText("wbgt.stopWorkOverride")).toBeNull();
  });

  it("still states the override in high contrast", async () => {
    // High contrast never dimmed, so the words were always the whole mechanism there. They
    // remain so; this asserts the two modes did not diverge when the dim was removed.
    mockTheme.mockReturnValue(theme(true));

    const { queryByText } = await render(<WbgtCard conditions={conditions()} superseded />);

    expect(queryByText("wbgt.stopWorkOverride")).not.toBeNull();
  });
});

describe("legibility (SCRUM-260)", () => {
  it("does not dim the card during a stop-work", async () => {
    const { toJSON } = await render(<WbgtCard conditions={conditions()} superseded />);

    // The 45% dim put black-on-white at roughly 3.5:1 — under AA — on the reading a worker
    // needs while deciding whether to keep working.
    const style = rootStyle(toJSON());
    expect(style.opacity === undefined || style.opacity === 1).toBe(true);
  });

  it("renders the card identically with and without a stop-work", async () => {
    const plain = await render(<WbgtCard conditions={conditions()} />);
    const stopped = await render(<WbgtCard conditions={conditions()} superseded />);

    // Apart from the override line, the two must be the same card. This is what fails if
    // someone reintroduces a dim, a tint or a border change to "make it clearer".
    expect(rootStyle(stopped.toJSON())).toEqual(rootStyle(plain.toJSON()));
  });
});

it("says a missing reading is missing, rather than showing a dash", async () => {
  // Unchanged by SCRUM-260 and asserted because the override line renders directly above
  // this branch: a null reading and a stop-work can occur together.
  const { queryByText } = await render(
    <WbgtCard conditions={conditions({ wbgt: null })} superseded />,
  );

  expect(queryByText("wbgt.noReading")).not.toBeNull();
  expect(queryByText("wbgt.stopWorkOverride")).not.toBeNull();
});
