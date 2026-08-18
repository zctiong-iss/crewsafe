/**
 * The site picker that replaced the radio list.
 *
 * The assertions that carry weight are about the twenty-site case the radio list could not
 * serve: every site is listed with its own reading, a site with no reading says so rather than
 * rendering as a cool one, and choosing a site both selects it and closes the sheet.
 *
 * @author Justin Chua
 */
import { fireEvent, render, screen } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import SiteConditionsPicker from "./SiteConditionsPicker";
import type { Site } from "@/types/domain";
import type { SiteWeatherSummary } from "@/api/endpoints/siteWeatherSummary";

function site(id: string, name: string): Site {
  return { id, name, latitude: "1.3", longitude: "103.8", timezone: "Asia/Singapore" };
}

const SITES = [site("s-1", "Bishan Park"), site("s-2", "NUS Campus"), site("s-3", "Tuas Yard")];

const SUMMARY: Record<string, SiteWeatherSummary> = {
  "s-1": {
    siteId: "s-1",
    wbgt: 26.7,
    band: "BELOW_31",
    observedAt: "2026-08-18T00:00:00Z",
    freshness: "LIVE",
  },
  "s-2": {
    siteId: "s-2",
    wbgt: 33.4,
    band: "33_AND_ABOVE",
    observedAt: "2026-08-18T00:00:00Z",
    freshness: "LIVE",
  },
  // s-3 deliberately absent: a site the ingestion has nothing for.
};

async function renderPicker(overrides: Partial<React.ComponentProps<typeof SiteConditionsPicker>> = {}) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  await render(
    <SiteConditionsPicker
      visible
      onClose={onClose}
      sites={SITES}
      selectedSiteId="s-1"
      onSelect={onSelect}
      summaryBySite={SUMMARY}
      {...overrides}
    />,
  );
  return { onSelect, onClose };
}

it("lists every site with its own reading", async () => {
  await renderPicker();

  // The whole point: which site is hot is visible without opening any of them.
  expect(screen.getByText("weather.degrees:26.7")).toBeTruthy();
  expect(screen.getByText("weather.degrees:33.4")).toBeTruthy();
  expect(screen.getByText("wbgt.band.BELOW_31")).toBeTruthy();
  expect(screen.getByText("wbgt.band.33_AND_ABOVE")).toBeTruthy();
});

it("says a site has no reading rather than rendering it as a cool one", async () => {
  await renderPicker();

  // s-3 has no summary. Showing it green would turn "we do not know" into "it is safe".
  expect(screen.getByText("weather.noReading")).toBeTruthy();
  expect(screen.getByText("Tuas Yard")).toBeTruthy();
});

it("colours each reading by its own band", async () => {
  await renderPicker();

  const { colors } = jest.requireActual("@/styles/theme").defaultTheme;
  const colorOf = (node: { props: { style?: unknown } }) => {
    const style = node.props.style;
    return (Array.isArray(style) ? Object.assign({}, ...style.flat()) : (style ?? {})).color;
  };

  expect(colorOf(screen.getByText("weather.degrees:26.7"))).toBe(colors.success);
  expect(colorOf(screen.getByText("weather.degrees:33.4"))).toBe(colors.danger);
});

it("names the site and its reading in one announcement", async () => {
  await renderPicker();

  // Hearing "Bishan Park" and "26.7 degrees" as two stops loses which belongs to which.
  expect(screen.getByLabelText(/^weather.siteRowReading:Bishan Park,26.7/)).toBeTruthy();
  expect(screen.getByLabelText("weather.siteRowNoReading:Tuas Yard")).toBeTruthy();
});

it("selects a site and closes on tap", async () => {
  const { onSelect, onClose } = await renderPicker();

  await fireEvent.press(screen.getByLabelText(/^weather.siteRowReading:NUS Campus/));

  expect(onSelect).toHaveBeenCalledWith("s-2");
  expect(onClose).toHaveBeenCalled();
});

it("marks the current site as selected", async () => {
  await renderPicker();

  const current = screen.getByLabelText(/^weather.siteRowReading:Bishan Park/);
  expect(current.props.accessibilityState.selected).toBe(true);
});

it("shows selection without changing what the row contains", async () => {
  /*
   * The regression this replaced a checkmark for. A trailing tick on the selected row pushed
   * the reading column left on that row alone, so temperatures no longer lined up down the
   * list — on a list built for comparing readings, the one thing it must not do.
   *
   * Asserted structurally: the selected row and an unselected one hold the same children, so
   * moving the selection cannot reflow anything. The accent bar is absolutely positioned and
   * present on every row, merely transparent when unselected.
   */
  await renderPicker();

  const selected = screen.getByLabelText(/^weather.siteRowReading:Bishan Park/);
  const unselected = screen.getByLabelText(/^weather.siteRowReading:NUS Campus/);

  expect(selected.children).toHaveLength(unselected.children.length);
});

it("carries selection on a bar that survives high contrast", async () => {
  /*
   * Not a border colour and not a fill: in high contrast `border` and `borderStrong` are both
   * #000000 and `surface` and `surfaceAlt` are both #FFFFFF, so neither of those changes is
   * visible there. Black against transparent is.
   */
  await renderPicker();

  const { colors } = jest.requireActual("@/styles/theme").defaultTheme;
  const barOf = (row: { children: unknown[] }) => {
    const bar = row.children[0] as { props: { style?: unknown } };
    const style = bar.props.style;
    return (Array.isArray(style) ? Object.assign({}, ...style.flat()) : (style ?? {}))
      .backgroundColor;
  };

  expect(barOf(screen.getByLabelText(/^weather.siteRowReading:Bishan Park/))).toBe(colors.primary);
  expect(barOf(screen.getByLabelText(/^weather.siteRowReading:NUS Campus/))).toBe("transparent");
});
