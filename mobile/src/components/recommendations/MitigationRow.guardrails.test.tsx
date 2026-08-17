/**
 * The ADR-0017 §6 guardrail gate, run against the plan screen's card (SCRUM-TBD-22).
 *
 * This is the merge blocker the ADR asks for, in the form of a test rather than a checklist.
 * Every case below is one line of §6:
 *
 *   fontScale 1.5 — no clipped pill, chip or label
 *   high contrast ON — chips visibly bordered, no fill-only cue
 *   long rule code — UNACCLIMATISED_HEAVY_WORK_RULE wraps, never truncates
 *   long worker list — chips wrap, then overflow to +N
 *   seven languages — all pill/chip text through AppText, rendered in Tamil to confirm
 *
 * A deliberate regression should fail this: restoring `maxWidth: s(110)` and
 * `numberOfLines={1}` on the origin pill — the exact styling this refactor removed — is
 * caught by `expectNoClipping`.
 */
import { fireEvent } from "@testing-library/react-native";

import {
  guardrailCases,
  renderUnderGuardrails,
  expectNoClipping,
  expectPillsBordered,
  expectTouchTargets,
  LONG_RULE_CODE,
  LONG_CREW,
  LONG_WORKER_NAME,
} from "@/testing/guardrails";
import type { Mitigation } from "@/types/domain";

/*
 * The theme is read per-case, so the mock is a mutable holder rather than a fixed object —
 * the whole point of the matrix is that the component is rendered under both palettes and
 * both ends of the text-size range.
 */
let mockTheme = jest.requireActual("@/styles/theme").buildTheme(false, 1);
let mockLanguage = "en";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => mockTheme,
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: mockLanguage },
  }),
}));

import MitigationRow from "./MitigationRow";

/** The worst case the gate describes: long code, long crew, long names, every field filled. */
function worstCase(): Mitigation {
  return {
    priority: "HIGH",
    action: "Rest 15 minutes every hour",
    rationale:
      "Worker is on day 2 of acclimatisation and the WBGT is forecast to exceed the heavy-work threshold before 14:00.",
    estimatedImpact: "Reduces heat strain by approximately 15-20% over the affected period.",
    actionCode: "REST_15_MIN_HOURLY",
    category: "REST",
    origin: "MANDATORY",
    ruleReference: LONG_RULE_CODE,
    appliesTo: LONG_CREW,
    timing: { durationMinutes: 15, everyMinutes: 60, startByUtc: null },
  };
}

describe.each(guardrailCases())("guardrail gate — $label", ({ theme, language }) => {
  beforeEach(() => {
    mockTheme = theme;
    mockLanguage = language;
  });

  it("renders the worst case without clipping any label", async () => {
    const tree = await renderUnderGuardrails(
      <MitigationRow mitigation={worstCase()} workerNameFor={() => LONG_WORKER_NAME} />,
    );
    expectNoClipping(tree);
  });

  it("keeps every pill and chip bordered", async () => {
    // In high contrast `surfaceAlt` collapses to `surface`; a fill-only chip would vanish.
    const tree = await renderUnderGuardrails(
      <MitigationRow mitigation={worstCase()} workerNameFor={() => LONG_WORKER_NAME} />,
    );
    expectPillsBordered(tree);
  });

  it("keeps the disclosure a full touch target", async () => {
    const tree = await renderUnderGuardrails(<MitigationRow mitigation={worstCase()} />);
    expectTouchTargets(tree);
  });

  it("overflows a long crew to +N rather than growing without bound", async () => {
    const tree = await renderUnderGuardrails(
      <MitigationRow mitigation={worstCase()} workerNameFor={() => LONG_WORKER_NAME} />,
    );
    // Eight workers, four chips shown.
    expect(tree.getByText("+4")).toBeTruthy();
  });

  it("wraps a long rule code in the expanded detail rather than truncating it", async () => {
    const tree = await renderUnderGuardrails(<MitigationRow mitigation={worstCase()} />);

    await fireEvent.press(tree.getByLabelText("recommendations.showDetails"));

    const code = tree.getByText(LONG_RULE_CODE);
    // No line clamp: the code wraps onto a second line instead of losing its tail.
    expect(code.props.numberOfLines).toBeUndefined();
    expectNoClipping(tree);
  });
});
