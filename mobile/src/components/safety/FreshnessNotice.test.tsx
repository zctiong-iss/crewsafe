/**
 * FreshnessNotice (SCRUM-352 / FR-001).
 *
 * The notice is what turns a stale/delayed/simulated badge into an instruction — see the
 * file's own header comment. Asserts the tone/key pairing for every status that shows a
 * notice, and that a fresh (LIVE) reading shows nothing at all.
 *
 * @author Justin Chua
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: { danger: "#B00020", warning: "#B26A00", textPrimary: "#111111", surface: "#FFFFFF" },
    metrics: { borderWidth: 1, radius: 12 },
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
}));

import FreshnessNotice, { showsStandingBanner } from "./FreshnessNotice";
import type { WeatherQualityStatus } from "@/types/domain";

describe.each<[WeatherQualityStatus, string]>([
  ["STALE", "freshness.staleWarning"],
  ["DELAYED", "freshness.delayedWarning"],
  ["SIMULATED", "freshness.simulatedNotice"],
])("status %s", (status, key) => {
  it(`renders the ${status} notice text`, async () => {
    const { queryByText } = await render(<FreshnessNotice status={status} />);
    expect(queryByText(key)).not.toBeNull();
  });
});

it("renders nothing for a LIVE reading", async () => {
  const { toJSON } = await render(<FreshnessNotice status="LIVE" />);
  expect(toJSON()).toBeNull();
});

describe("accessibility (SCRUM-352 / FR-006, User Story 3)", () => {
  it("exposes the notice as one accessible label via MessageBanner, not just visible text", async () => {
    const { getByLabelText } = await render(<FreshnessNotice status="STALE" />);
    // MessageBanner sets accessibilityLabel={message} on its container — asserting that
    // directly, rather than only on the child <Text>, is what a screen reader actually reads.
    expect(getByLabelText("freshness.staleWarning")).not.toBeNull();
  });
});

describe("which states keep a banner that is always on screen", () => {
  /*
   * The decision at the centre of the weather-status change, and the reason it is a named
   * function rather than a `status === "STALE"` on the screen.
   *
   * DELAYED and SIMULATED moved behind a tap on the weather card, because a permanent banner
   * on the screen a worker checks most often is read as furniture by the tenth viewing. STALE
   * did not move with them: §7.1's rule matrix requires stale data to "show warning", and a
   * warning only visible after tapping an icon nobody had reason to tap has not been shown.
   *
   * Anyone tidying this into consistency with the others is overruling that, and this test is
   * where they find out.
   */
  it("keeps one for STALE, where the reading must not be acted on at all", () => {
    expect(showsStandingBanner("STALE")).toBe(true);
  });

  it.each(["DELAYED", "SIMULATED", "LIVE"] as const)(
    "does not keep one for %s",
    (status) => {
      expect(showsStandingBanner(status)).toBe(false);
    },
  );
});
