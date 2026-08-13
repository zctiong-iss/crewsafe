/**
 * PolicyStatusPill (SCRUM-352 / FR-001, SCRUM-120).
 *
 * Only the ACTIVE version is filled — a version history is mostly retired versions, and the
 * fill is what tells a safety manager which one actually governs (see the file's own header
 * comment). Asserts the label and fill state for all three statuses.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: { success: "#1B7A3D", warningFill: "#8A5000", textSecondary: "#666666", textInverse: "#FFFFFF" },
    metrics: { borderWidth: 1, radius: 12 },
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import PolicyStatusPill from "./PolicyStatusPill";

it("labels an ACTIVE version and fills the pill", async () => {
  const { queryByText, toJSON } = await render(<PolicyStatusPill status="ACTIVE" />);
  expect(queryByText("policy.statusActive")).not.toBeNull();
  const root = toJSON() as unknown as { props: { style: Array<Record<string, unknown>> } };
  const style = Object.assign({}, ...root.props.style);
  expect(style.backgroundColor).not.toBe("transparent");
});

it("labels a DRAFT version without filling the pill", async () => {
  const { queryByText, toJSON } = await render(<PolicyStatusPill status="DRAFT" />);
  expect(queryByText("policy.statusDraft")).not.toBeNull();
  const root = toJSON() as unknown as { props: { style: Array<Record<string, unknown>> } };
  const style = Object.assign({}, ...root.props.style);
  expect(style.backgroundColor).toBe("transparent");
});

it("labels a SUPERSEDED version without filling the pill", async () => {
  const { queryByText, toJSON } = await render(<PolicyStatusPill status="SUPERSEDED" />);
  expect(queryByText("policy.statusSuperseded")).not.toBeNull();
  const root = toJSON() as unknown as { props: { style: Array<Record<string, unknown>> } };
  const style = Object.assign({}, ...root.props.style);
  expect(style.backgroundColor).toBe("transparent");
});

describe("accessibility (SCRUM-352 / FR-006, User Story 3)", () => {
  it("exposes a non-empty accessible label for the active status", async () => {
    const { getByText } = await render(<PolicyStatusPill status="ACTIVE" />);
    const label = getByText("policy.statusActive");
    expect(label.props.children).toBeTruthy();
  });
});
