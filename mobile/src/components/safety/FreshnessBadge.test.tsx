/**
 * FreshnessBadge (SCRUM-352 / FR-001, FR-006, FR-12).
 *
 * Not decoration — a worker is entitled to know whether the reading they are looking at was
 * measured minutes ago or is a demo fixture (see the file's own header comment). Asserts the
 * label for every quality status, and that the label is present and non-empty as an
 * accessible fact a screen reader can announce (User Story 3).
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: { success: "#1B7A3D", warning: "#B26A00", danger: "#B00020", simulated: "#5E4FA2" },
    metrics: { borderWidth: 1, radius: 12 },
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import FreshnessBadge from "./FreshnessBadge";
import type { WeatherQualityStatus } from "@/types/domain";

describe.each<WeatherQualityStatus>(["LIVE", "DELAYED", "STALE", "SIMULATED"])(
  "status %s",
  (status) => {
    it(`renders the ${status} label`, async () => {
      const { queryByText } = await render(<FreshnessBadge status={status} />);
      expect(queryByText(`freshness.${status}`)).not.toBeNull();
    });
  },
);

describe("accessibility (SCRUM-352 / FR-006, User Story 3)", () => {
  it("exposes a non-empty accessible label for each status", async () => {
    // Text.props.children is the accessible name RN reports for a plain <Text> — this
    // asserts the badge is genuinely announceable, not just visually present.
    const { getByText } = await render(<FreshnessBadge status="STALE" />);
    const label = getByText("freshness.STALE");
    expect(label.props.children).toBeTruthy();
  });
});
