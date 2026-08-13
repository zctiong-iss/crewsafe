/**
 * LightningBanner (SCRUM-352 / FR-001, SCRUM-172, FR-12a).
 *
 * Four rendered states from two inputs (risk state x expiry) — see the file's own header
 * comment for why stop-work must outrank the other two by more than colour, and why expiry
 * is deliberately not an all-clear. Also covers the seconds/minutes countdown boundary at
 * risk.validUntil, exactly the kind of off-by-one the header comment calls out.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: {
      textSecondary: "#666666",
      danger: "#B00020",
      warning: "#B26A00",
      warningFill: "#8A5000",
      success: "#1B7A3D",
      textInverse: "#FFFFFF",
      surface: "#FFFFFF",
    },
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

import LightningBanner from "./LightningBanner";
import type { LightningRisk } from "@/types/domain";

const NOW = new Date("2026-08-13T02:00:00Z").getTime();

/** Depth-first search of the rendered tree for a node carrying this accessibilityRole. */
function findByAccessibilityRole(node: unknown, role: string): boolean {
  if (!node || typeof node !== "object") return false;
  const el = node as { props?: { accessibilityRole?: string }; children?: unknown[] };
  if (el.props?.accessibilityRole === role) return true;
  return (el.children ?? []).some((child) => findByAccessibilityRole(child, role));
}

function risk(overrides: Partial<LightningRisk> = {}): LightningRisk {
  return {
    siteId: "s1",
    state: "CLEAR",
    nearestStrikeKm: null,
    observedAt: "2026-08-13T01:50:00Z",
    validUntil: "2026-08-13T02:30:00Z",
    ...overrides,
  };
}

it("shows the stop-work title while active", async () => {
  const { queryByText } = await render(
    <LightningBanner risk={risk({ state: "STOP_WORK" })} locale="en" now={NOW} />,
  );
  expect(queryByText("lightning.stopWorkTitle")).not.toBeNull();
});

it("shows the advisory title while active, distinct from stop-work", async () => {
  const { queryByText } = await render(
    <LightningBanner risk={risk({ state: "ADVISORY" })} locale="en" now={NOW} />,
  );
  expect(queryByText("lightning.advisoryTitle")).not.toBeNull();
  expect(queryByText("lightning.stopWorkTitle")).toBeNull();
});

it("shows the clear title when the site was assessed clear", async () => {
  const { queryByText } = await render(
    <LightningBanner risk={risk({ state: "CLEAR" })} locale="en" now={NOW} />,
  );
  expect(queryByText("lightning.clearTitle")).not.toBeNull();
});

it("shows the expired title, not the clear title, once validUntil has passed", async () => {
  const { queryByText } = await render(
    <LightningBanner
      risk={risk({ state: "STOP_WORK", validUntil: "2026-08-13T01:00:00Z" })}
      locale="en"
      now={NOW}
    />,
  );
  // Expiry is never rendered as an all-clear, even for a state that would otherwise read
  // as reassuring — see the header comment's "why expiry is not an all-clear".
  expect(queryByText("lightning.expiredTitle")).not.toBeNull();
  expect(queryByText("lightning.clearTitle")).toBeNull();
  expect(queryByText("lightning.stopWorkTitle")).toBeNull();
});

it("announces as an alert only for an active stop-work", async () => {
  const { toJSON } = await render(
    <LightningBanner risk={risk({ state: "STOP_WORK" })} locale="en" now={NOW} />,
  );
  expect(findByAccessibilityRole(toJSON(), "alert")).toBe(true);
});

it("does not announce an expired stop-work banner as an alert", async () => {
  const { toJSON } = await render(
    <LightningBanner
      risk={risk({ state: "STOP_WORK", validUntil: "2026-08-13T01:00:00Z" })}
      locale="en"
      now={NOW}
    />,
  );
  expect(findByAccessibilityRole(toJSON(), "alert")).toBe(false);
});

it("switches the countdown to seconds under one minute remaining", async () => {
  const { queryByText } = await render(
    <LightningBanner
      risk={risk({ state: "ADVISORY", validUntil: "2026-08-13T02:00:45Z" })}
      locale="en"
      now={NOW}
    />,
  );
  expect(queryByText("lightning.refreshesInSeconds")).not.toBeNull();
});

it("shows a minutes countdown at exactly one minute remaining", async () => {
  const { queryByText } = await render(
    <LightningBanner
      risk={risk({ state: "ADVISORY", validUntil: "2026-08-13T02:01:00Z" })}
      locale="en"
      now={NOW}
    />,
  );
  expect(queryByText("lightning.refreshesInMinutes")).not.toBeNull();
});

it("shows no countdown once expired", async () => {
  const { queryByText } = await render(
    <LightningBanner
      risk={risk({ state: "ADVISORY", validUntil: "2026-08-13T01:00:00Z" })}
      locale="en"
      now={NOW}
    />,
  );
  expect(queryByText("lightning.refreshesInSeconds")).toBeNull();
  expect(queryByText("lightning.refreshesInMinutes")).toBeNull();
});

describe("accessibility (SCRUM-352 / FR-006, User Story 3)", () => {
  it("exposes a non-empty accessible label combining the title and body", async () => {
    const { getByLabelText } = await render(
      <LightningBanner risk={risk({ state: "STOP_WORK" })} locale="en" now={NOW} />,
    );
    // Composed from the title and body — already explicit on the component (see
    // accessibilityLabel in LightningBanner.tsx) — asserted here as the accessible fact a
    // screen reader announces, not just the visible text.
    const label = getByLabelText("lightning.stopWorkTitle. lightning.stopWorkBody");
    expect(label).not.toBeNull();
  });
});
