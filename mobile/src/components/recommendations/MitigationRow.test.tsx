/**
 * What an explainable mitigation must say (SCRUM-118 / US-08), now in two tiers (ADR-0017 §3).
 *
 * Two cases carry the story. A mitigation with no `appliesTo` covers the whole crew and has to say
 * so in words — rendering nothing would leave the difference between "these two people" and
 * "everyone" to blank space, and that difference is the entire point of the field. And a
 * mitigation carrying none of PR #205's fields must still render exactly as it does today, because
 * that PR keeps them optional and this client ships before it merges.
 *
 * The progressive-disclosure refactor adds a third: the split must not lose anything. Reason,
 * rule and expected effect are now behind an expand, so every assertion about them has to press
 * the control first — and there is a test that they are genuinely absent until it is pressed,
 * because a disclosure that renders its contents anyway is just a broken card.
 *
 * @author Justin Chua
 */
import { render, fireEvent } from "@testing-library/react-native";

import MitigationRow from "./MitigationRow";
import type { Mitigation } from "@/types/domain";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: {
      danger: "#C71A34",
      warning: "#B26A00",
      success: "#1B5E20",
      primary: "#000000",
      textSecondary: "#4A4A4A",
      textPrimary: "#000000",
      textInverse: "#FFFFFF",
      surfaceAlt: "#F6F6F6",
      border: "#CCCCCC",
    },
    metrics: { borderWidth: 1, radius: 12 },
    fontScale: 1,
    highContrast: false,
  }),
}));

/* `ExpandChevron` reads the Reduce Motion preference, which reaches the store and the native
   AccessibilityInfo module — neither exists here. Same stub the other chevron tests use. */
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));

/** Renders the key, so an assertion names the string the screen actually resolves. */
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));

function mitigation(overrides: Partial<Mitigation> = {}): Mitigation {
  return {
    priority: "HIGH",
    action: "Rest 15 minutes every hour",
    rationale: null,
    estimatedImpact: null,
    actionCode: "REST_15_MIN_HOURLY",
    category: "REST",
    origin: null,
    ruleReference: null,
    appliesTo: null,
    timing: null,
    ...overrides,
  };
}

/* ── Summary tier — always visible ─────────────────────────────────────────────────────── */

it("says everyone when appliesTo is absent", async () => {
  const { getByText } = await render(<MitigationRow mitigation={mitigation()} />);

  // Absent means the whole shift. Silence would be indistinguishable from "nobody".
  expect(getByText("recommendations.appliesToAll")).toBeTruthy();
});

it("treats an empty appliesTo the same as an absent one", async () => {
  const { getByText } = await render(<MitigationRow mitigation={mitigation({ appliesTo: [] })} />);
  expect(getByText("recommendations.appliesToAll")).toBeTruthy();
});

it("names each worker in its own chip rather than as one joined sentence", async () => {
  const { getByText, queryByText } = await render(
    <MitigationRow
      mitigation={mitigation({ appliesTo: ["w-1", "w-2"] })}
      workerNameFor={(id) => (id === "w-1" ? "Meng Hui" : "Siti")}
    />,
  );

  expect(getByText("Meng Hui")).toBeTruthy();
  expect(getByText("Siti")).toBeTruthy();
  // The old comma-joined rendering is gone; chips wrap where a sentence would overflow.
  expect(queryByText("Meng Hui, Siti")).toBeNull();
  expect(queryByText("recommendations.appliesToAll")).toBeNull();
});

it("falls back to the raw id rather than dropping an unresolvable worker", async () => {
  // `GET /workers` returns ACTIVE workers only, so someone since offboarded resolves to no name.
  // Omitting them would understate who an action covers.
  const { getByText } = await render(
    <MitigationRow mitigation={mitigation({ appliesTo: ["gone"] })} />,
  );

  expect(getByText("gone")).toBeTruthy();
});

it("collapses a long crew into four chips plus a +N", async () => {
  // The guardrail-gate case: a chip per worker on a 12-person crew pushes the disclosure
  // control off-screen, which hides the evidence behind an affordance nobody can see.
  const { getByText, queryByText } = await render(
    <MitigationRow
      mitigation={mitigation({ appliesTo: ["a", "b", "c", "d", "e", "f"] })}
      workerNameFor={(id) => id.toUpperCase()}
    />,
  );

  expect(getByText("A")).toBeTruthy();
  expect(getByText("D")).toBeTruthy();
  expect(queryByText("E")).toBeNull();
  expect(getByText("+2")).toBeTruthy();
});

it("shows no +N chip when the crew fits exactly", async () => {
  const { queryByText } = await render(
    <MitigationRow
      mitigation={mitigation({ appliesTo: ["a", "b", "c", "d"] })}
      workerNameFor={(id) => id.toUpperCase()}
    />,
  );

  expect(queryByText("+0")).toBeNull();
});

it("composes timing from the typed fields, saying 'every hour' for 60", async () => {
  const { getByText } = await render(
    <MitigationRow
      mitigation={mitigation({ timing: { durationMinutes: 15, everyMinutes: 60, startByUtc: null } })}
    />,
  );

  // "every 60 min" is how a database says it; a person says "every hour".
  expect(getByText("recommendations.timingDuration:15 · recommendations.timingEveryHour")).toBeTruthy();
});

it("keeps minutes when the recurrence is not hourly", async () => {
  const { getByText } = await render(
    <MitigationRow
      mitigation={mitigation({ timing: { durationMinutes: null, everyMinutes: 30, startByUtc: null } })}
    />,
  );

  expect(getByText("recommendations.timingEveryMinutes:30")).toBeTruthy();
});

it("marks a mandatory action apart from an advisory one", async () => {
  const required = await render(<MitigationRow mitigation={mitigation({ origin: "MANDATORY" })} />);
  expect(required.getByText("recommendations.originMandatory")).toBeTruthy();

  const suggested = await render(<MitigationRow mitigation={mitigation({ origin: "ADVISORY" })} />);
  expect(suggested.getByText("recommendations.originAdvisory")).toBeTruthy();
});

/* ── Detail tier — behind the disclosure ───────────────────────────────────────────────── */

it("keeps the evidence hidden until the disclosure is pressed", async () => {
  // The whole point of the refactor: a card that renders its detail tier anyway is the
  // always-on block with an extra button.
  const { queryByText } = await render(
    <MitigationRow
      mitigation={mitigation({
        rationale: "Worker is on day 2 of acclimatisation",
        ruleReference: "UNACCLIMATISED_HEAVY_WORK_RULE",
        estimatedImpact: "Reduces heat strain by 15-20%",
      })}
    />,
  );

  expect(queryByText("Worker is on day 2 of acclimatisation")).toBeNull();
  expect(queryByText("UNACCLIMATISED_HEAVY_WORK_RULE")).toBeNull();
  expect(queryByText("Reduces heat strain by 15-20%")).toBeNull();
});

it("reveals reason, rule and expected effect once expanded", async () => {
  const { getByText, getByLabelText } = await render(
    <MitigationRow
      mitigation={mitigation({
        rationale: "Worker is on day 2 of acclimatisation",
        ruleReference: "UNACCLIMATISED_HEAVY_WORK_RULE",
        estimatedImpact: "Reduces heat strain by 15-20%",
      })}
    />,
  );

  await fireEvent.press(getByLabelText("recommendations.showDetails"));

  expect(getByText("Worker is on day 2 of acclimatisation")).toBeTruthy();
  expect(getByText("UNACCLIMATISED_HEAVY_WORK_RULE")).toBeTruthy();
  expect(getByText("Reduces heat strain by 15-20%")).toBeTruthy();
});

it("hides the evidence again when collapsed", async () => {
  const { queryByText, getByLabelText } = await render(
    <MitigationRow mitigation={mitigation({ rationale: "Because of the heat" })} />,
  );

  await fireEvent.press(getByLabelText("recommendations.showDetails"));
  expect(queryByText("Because of the heat")).toBeTruthy();

  await fireEvent.press(getByLabelText("recommendations.hideDetails"));
  expect(queryByText("Because of the heat")).toBeNull();
});

it("exposes the disclosure as a button that reports its expanded state", async () => {
  // The chevron is silent to a screen reader; without these a supervisor using TalkBack has
  // no way to know the control exists, let alone whether it is open.
  const { getByLabelText } = await render(<MitigationRow mitigation={mitigation()} />);

  const toggle = getByLabelText("recommendations.showDetails");
  expect(toggle.props.accessibilityRole).toBe("button");
  expect(toggle.props.accessibilityState.expanded).toBe(false);

  await fireEvent.press(toggle);
  expect(getByLabelText("recommendations.hideDetails").props.accessibilityState.expanded).toBe(true);
});

/* ── Suppression ───────────────────────────────────────────────────────────────────────── */

it("renders neither chips nor a disclosure when showDetail is off", async () => {
  // The edit sheet passes showDetail={false}; a disclosure control there would compete with
  // the sheet's own controls.
  const { queryByText, queryByLabelText } = await render(
    <MitigationRow mitigation={mitigation({ appliesTo: ["w-1"] })} showDetail={false} />,
  );

  expect(queryByText("recommendations.appliesToAll")).toBeNull();
  expect(queryByLabelText("recommendations.showDetails")).toBeNull();
});

it("renders neither chips nor a disclosure for a removed mitigation", async () => {
  const { queryByLabelText, getByText } = await render(
    <MitigationRow mitigation={mitigation()} removed />,
  );

  expect(queryByLabelText("recommendations.showDetails")).toBeNull();
  expect(getByText("recommendations.removedLabel")).toBeTruthy();
});

it("renders a pre-#205 mitigation without inventing any of the new fields", async () => {
  const { queryByText, getByText, getByLabelText } = await render(
    <MitigationRow mitigation={mitigation()} />,
  );

  /* The action still renders. The code resolves through `actions.*` with the server prose as the
     defaultValue, which the stub above renders as "key:default" — the point being that the label
     comes from the code, not from parsing the prose. */
  expect(getByText("actions.REST_15_MIN_HOURLY:Rest 15 minutes every hour")).toBeTruthy();
  expect(queryByText("recommendations.originMandatory")).toBeNull();
  expect(queryByText("recommendations.originAdvisory")).toBeNull();

  // Expanding an all-null mitigation shows an empty detail tier rather than empty labels.
  await fireEvent.press(getByLabelText("recommendations.showDetails"));
  expect(queryByText("recommendations.ruleReference")).toBeNull();
  expect(queryByText("recommendations.rationale")).toBeNull();
  expect(queryByText("recommendations.estimatedImpact")).toBeNull();
});
