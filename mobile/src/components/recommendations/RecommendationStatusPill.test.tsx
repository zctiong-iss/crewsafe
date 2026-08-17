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

// The regression every row here guards: a fall-through chain used to render any status it
// didn't explicitly recognise as green "Approved" — DRAFT and SUPERSEDED were both once
// missing from it and rendered that way. AUTO_DISPATCHED (SCRUM-440) is the same regression
// class in the opposite direction: misleading not because nobody decided (SUPERSEDED), but
// because this plan genuinely is in effect, just never through a supervisor's decision.
it.each([
  ["DRAFT", "recommendations.statusDraft"],
  ["SUPERSEDED", "recommendations.statusSuperseded"],
  ["AUTO_DISPATCHED", "recommendations.statusAutoDispatched"],
] as const)("labels a %s recommendation distinctly, not as approved", async (status, labelKey) => {
  const { queryByText } = await render(<RecommendationStatusPill status={status} />);
  expect(queryByText(labelKey)).not.toBeNull();
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
