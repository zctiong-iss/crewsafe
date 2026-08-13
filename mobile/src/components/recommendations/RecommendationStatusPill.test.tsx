/**
 * RecommendationStatusPill (SCRUM-352 / FR-004, SCRUM-119).
 *
 * DRAFT is a legal backend value that a fall-through chain used to render as green
 * "Approved" — see the file's own header comment. Asserts every status renders its own
 * label rather than falling through, and that EDITED is distinguished from a plain approval.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: { warningFill: "#8A5000", danger: "#B00020", textSecondary: "#666666", success: "#1B7A3D", textInverse: "#FFFFFF" },
    metrics: { borderWidth: 1, radius: 12 },
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import RecommendationStatusPill from "./RecommendationStatusPill";

it("labels a pending recommendation as pending", async () => {
  const { queryByText } = await render(<RecommendationStatusPill status="PENDING_APPROVAL" />);
  expect(queryByText("recommendations.pending")).not.toBeNull();
});

it("labels a rejected recommendation as rejected", async () => {
  const { queryByText } = await render(<RecommendationStatusPill status="REJECTED" />);
  expect(queryByText("recommendations.decidedRejected")).not.toBeNull();
});

it("labels a DRAFT recommendation as draft, not as approved", async () => {
  // The regression this guards: a fall-through chain used to render any unrecognised status,
  // DRAFT included, as green "Approved" — a plan nobody approved showing as approved.
  const { queryByText } = await render(<RecommendationStatusPill status="DRAFT" />);
  expect(queryByText("recommendations.statusDraft")).not.toBeNull();
  expect(queryByText("recommendations.decidedApproved")).toBeNull();
});

it("labels a plain approval as approved", async () => {
  const { queryByText } = await render(
    <RecommendationStatusPill status="APPROVED" decision="APPROVED" />,
  );
  expect(queryByText("recommendations.decidedApproved")).not.toBeNull();
});

it("distinguishes an edited approval from a plain one", async () => {
  const { queryByText } = await render(
    <RecommendationStatusPill status="APPROVED" decision="EDITED" />,
  );
  expect(queryByText("recommendations.decidedEdited")).not.toBeNull();
  expect(queryByText("recommendations.decidedApproved")).toBeNull();
});
