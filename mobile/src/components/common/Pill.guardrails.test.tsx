/**
 * The ADR-0017 §6 gate, run against the four pills migrated in Phase 2 (SCRUM-TBD-35).
 *
 * ── THE CHANGE THIS EXISTS TO WATCH ─────────────────────────────────────────────────────
 * `RecommendationStatusPill` and `PolicyStatusPill` both shipped with `numberOfLines={1}`,
 * documented against a real defect: a pill whose label wrapped painted its second line
 * OUTSIDE its own fill, so "Waiting on your decision" rendered as "Waiting on your" with the
 * last word simply gone — no ellipsis to admit it.
 *
 * The migration drops that clamp, because ADR-0017 §6 forbids clipping and because a status
 * pill reading "Waiting on your…" undermines the ADR's own rule that the text is the source
 * of truth and the colour is only reinforcement. A truncated label is a worse failure than a
 * two-line one.
 *
 * That is safe only because `Pill` carries the STRUCTURAL half of the original fix — the
 * `flexDirection: "row"` + `maxWidth: "100%"` + `flexShrink` combination that made the pill
 * measure against its whole string rather than its first break opportunity. The clamp was
 * belt-and-braces on top of that. These cases assert the structural half is present in every
 * language and at every text size.
 *
 * ── WHAT STILL NEEDS HUMAN EYES ─────────────────────────────────────────────────────────
 * The test renderer has no layout engine, so it cannot prove the second line paints inside
 * the fill — only that nothing clamps and nothing caps the width. Confirming the wrap renders
 * correctly is the judgement half of the gate and is called out in the plan doc.
 */
import { guardrailCases, renderUnderGuardrails, expectNoClipping, expectPillsBordered, formatDiagnosticValue } from "@/testing/guardrails";

it("formats primitive and object-shaped clamp diagnostics deterministically", () => {
  expect(formatDiagnosticValue(1)).toBe("1");
  expect(formatDiagnosticValue({ limit: 1, source: "test" })).toBe('{"limit":1,"source":"test"}');
});

let mockTheme = jest.requireActual("@/styles/theme").buildTheme(false, 1);
let mockLanguage = "en";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => LONGEST_LABELS[key] ?? key,
    i18n: { language: mockLanguage },
  }),
}));

/**
 * The longest real translation of each label, so the gate tests the worst case rather than
 * the English one.
 *
 * These are the actual strings from `ta.json` / `my.json` — the two scripts with the tallest
 * line box and the longest words, which is where a pill runs out of room first.
 */
const LONGEST_LABELS: Record<string, string> = {
  "recommendations.pending": "உங்கள் முடிவுக்காகக் காத்திருக்கிறது",
  "recommendations.decidedRejected": "நிராகரிக்கப்பட்டது",
  "recommendations.statusAutoDispatched": "அனுப்பப்பட்டது",
  "policy.statusActive": "အသက်ဝင်နေသည်",
  "policy.statusSuperseded": "အစားထိုးပြီး",
  "shifts.status.ACTIVE": "လက်ရှိလုပ်ဆောင်နေသည်",
  "shifts.status.PLANNED": "စီစဉ်ထားသည်",
  "freshness.STALE": "காலாவதியான தரவு",
  "freshness.SIMULATED": "உருவகப்படுத்தப்பட்டது",
};

import RecommendationStatusPill from "@/components/recommendations/RecommendationStatusPill";
import PolicyStatusPill from "@/components/policy/PolicyStatusPill";
import ShiftStatusPill from "@/components/shifts/ShiftStatusPill";
import FreshnessBadge from "@/components/safety/FreshnessBadge";

const SUBJECTS = [
  { name: "RecommendationStatusPill · pending", element: <RecommendationStatusPill status="PENDING_APPROVAL" /> },
  { name: "RecommendationStatusPill · rejected", element: <RecommendationStatusPill status="REJECTED" /> },
  { name: "RecommendationStatusPill · auto-dispatched", element: <RecommendationStatusPill status="AUTO_DISPATCHED" /> },
  { name: "PolicyStatusPill · active", element: <PolicyStatusPill status="ACTIVE" /> },
  { name: "PolicyStatusPill · superseded", element: <PolicyStatusPill status="SUPERSEDED" /> },
  { name: "ShiftStatusPill · active", element: <ShiftStatusPill status="ACTIVE" /> },
  { name: "ShiftStatusPill · planned", element: <ShiftStatusPill status="PLANNED" /> },
  { name: "FreshnessBadge · stale", element: <FreshnessBadge status="STALE" /> },
  { name: "FreshnessBadge · simulated", element: <FreshnessBadge status="SIMULATED" /> },
];

describe.each(guardrailCases())("guardrail gate — $label", ({ theme, language }) => {
  beforeEach(() => {
    mockTheme = theme;
    mockLanguage = language;
  });

  it.each(SUBJECTS)("$name renders its longest label without clipping", async ({ element }) => {
    const tree = await renderUnderGuardrails(element);
    expectNoClipping(tree);
  });

  it.each(SUBJECTS)("$name keeps a visible border", async ({ element }) => {
    // In high contrast the fills collapse; the border is the only edge left.
    const tree = await renderUnderGuardrails(element);
    expectPillsBordered(tree);
  });
});
