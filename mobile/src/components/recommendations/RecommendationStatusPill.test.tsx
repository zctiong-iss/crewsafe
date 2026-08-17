/**
 * RecommendationStatusPill (SCRUM-352 / FR-004, SCRUM-119).
 *
 * DRAFT is a legal backend value that a fall-through chain used to render as green
 * "Approved" — see the file's own header comment. Asserts every status renders its own
 * label rather than falling through, and that EDITED is distinguished from a plain approval.
 */
import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { buildTheme } from "@/styles/theme";

/* The real theme, not a partial stub: since ADR-0017 this component renders through `Pill`,
   which reads `warningFill`, `surfaceAlt` and `border` too. A stub missing one of those would
   assert `undefined === undefined` and pass while the pill rendered transparent. */
const mockTheme = buildTheme(false, 1);

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
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

it("labels a SUPERSEDED recommendation as superseded, not as approved", async () => {
  // Same regression class as DRAFT: SUPERSEDED (SCRUM-291) is a legal backend status with no
  // Approval row behind it, so a fall-through here would render it green "Approved" too.
  const { queryByText } = await render(<RecommendationStatusPill status="SUPERSEDED" />);
  expect(queryByText("recommendations.statusSuperseded")).not.toBeNull();
  expect(queryByText("recommendations.decidedApproved")).toBeNull();
});

it("labels an AUTO_DISPATCHED recommendation distinctly, not as approved", async () => {
  // Same regression class as DRAFT/SUPERSEDED: AUTO_DISPATCHED (SCRUM-440) is a legal backend
  // status with no Approval row behind it either, so a fall-through here would render it green
  // "Approved" too -- misleading in the opposite direction from SUPERSEDED, since this plan
  // genuinely is in effect, just never through a supervisor's decision.
  const { queryByText } = await render(<RecommendationStatusPill status="AUTO_DISPATCHED" />);
  expect(queryByText("recommendations.statusAutoDispatched")).not.toBeNull();
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

/* ── The fill rule (ADR-0017 §4) ────────────────────────────────────────────────────────── */

/** The flattened style of the pill surface — the nearest bordered ancestor of the label. */
async function surfaceOf(element: React.ReactElement, label: string) {
  const { getByText } = await render(element);
  let node = getByText(label).parent;
  while (node) {
    const flat = StyleSheet.flatten(node.props?.style);
    if (flat && flat.borderWidth !== undefined) return flat;
    node = node.parent;
  }
  throw new Error("no pill surface found");
}

it("fills ONLY the pending pill — the one status asking for a decision", async () => {
  // The load-bearing rule of ADR-0017 §4. If a decided plan also filled, the pending pill
  // would stop standing out in a list, which is the entire reason fill is reserved.
  const pending = await surfaceOf(
    <RecommendationStatusPill status="PENDING_APPROVAL" />,
    "recommendations.pending",
  );
  expect(pending.backgroundColor).toBe(mockTheme.colors.warningFill);

  for (const [status, label] of [
    ["REJECTED", "recommendations.decidedRejected"],
    ["DRAFT", "recommendations.statusDraft"],
    ["SUPERSEDED", "recommendations.statusSuperseded"],
    ["AUTO_DISPATCHED", "recommendations.statusAutoDispatched"],
  ] as const) {
    const style = await surfaceOf(<RecommendationStatusPill status={status} />, label);
    expect({ status, fill: style.backgroundColor }).toEqual({ status, fill: "transparent" });
  }
});

it("fills the pending pill with warningFill so its white label clears AA", async () => {
  // `warning` is 4.24:1 against white and would fail; `warningFill` is the darkened value
  // that exists precisely for a filled pill. See colors.ts.
  const style = await surfaceOf(
    <RecommendationStatusPill status="PENDING_APPROVAL" />,
    "recommendations.pending",
  );
  expect(style.backgroundColor).not.toBe(mockTheme.colors.warning);
});

it("keeps an auto-dispatched stop-work in danger, not muted grey", async () => {
  // SCRUM-440: nothing left to tap, but a stop-work already in effect is the most severe
  // thing this screen shows and must not recede like a superseded draft.
  const style = await surfaceOf(
    <RecommendationStatusPill status="AUTO_DISPATCHED" />,
    "recommendations.statusAutoDispatched",
  );
  expect(style.borderColor).toBe(mockTheme.colors.danger);
});
