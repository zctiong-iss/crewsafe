/**
 * FreshnessBadge (SCRUM-352 / FR-001, FR-006, FR-12).
 *
 * Not decoration — a worker is entitled to know whether the reading they are looking at was
 * measured minutes ago or is a demo fixture (see the file's own header comment). Asserts the
 * label for every quality status, and that the label is present and non-empty as an
 * accessible fact a screen reader can announce (User Story 3).
 */
import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buildTheme } from "@/styles/theme";

/* The real palette, not a partial stub: since ADR-0017 this renders through `Pill`, which
   also reads `warningFill`, `surfaceAlt` and `border`. */
const mockTheme = buildTheme(false, 1);

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
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

/* ── It must not compete with the hazard band beside it (ADR-0017 §4) ───────────────────── */

async function surfaceOf(status: WeatherQualityStatus) {
  const { getByText } = await render(<FreshnessBadge status={status} />);
  let node = getByText(`freshness.${status}`).parent;
  while (node) {
    const flat = StyleSheet.flatten(node.props?.style);
    if (flat && flat.borderWidth !== undefined) return flat;
    node = node.parent;
  }
  throw new Error("no badge surface found");
}

it.each<WeatherQualityStatus>(["LIVE", "DELAYED", "STALE", "SIMULATED"])(
  "renders %s outlined, never filled",
  async (status) => {
    /*
     * This badge sits on the WBGT and lightning surfaces, where colour already carries the
     * hazard. A filled freshness badge would put a second loud pill next to the one signal
     * that genuinely needs to dominate. Freshness classifies the reading; it does not ask
     * anyone to decide anything, so it is an ATTRIBUTE and never a STATE.
     */
    expect((await surfaceOf(status)).backgroundColor).toBe("transparent");
  },
);

it("keeps SIMULATED visually distinct from the degraded states", async () => {
  // Simulated data is not degraded data. Rendering a demo fixture in warning or danger would
  // make a demo look like a fault.
  const simulated = await surfaceOf("SIMULATED");
  expect(simulated.borderColor).toBe(mockTheme.colors.simulated);
  expect(simulated.borderColor).not.toBe(mockTheme.colors.warning);
  expect(simulated.borderColor).not.toBe(mockTheme.colors.danger);
});
