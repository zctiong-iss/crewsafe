/**
 * What an explainable mitigation must say (SCRUM-118 / US-08).
 *
 * Two cases carry the story. A mitigation with no `appliesTo` covers the whole crew and has to say
 * so in words — rendering nothing would leave the difference between "these two people" and
 * "everyone" to blank space, and that difference is the entire point of the field. And a
 * mitigation carrying none of PR #205's fields must still render exactly as it does today, because
 * that PR keeps them optional and this client ships before it merges.
 *
 * @author Justin Chua
 */
import { render } from "@testing-library/react-native";

import MitigationRow from "./MitigationRow";
import type { Mitigation } from "@/types/domain";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: { danger: "#C71A34", textSecondary: "#4A4A4A", textPrimary: "#000000" },
    metrics: { borderWidth: 1, radius: 12 },
  }),
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

it("says everyone when appliesTo is absent", async () => {
  const { getByText } = await render(<MitigationRow mitigation={mitigation()} />);

  // Absent means the whole shift. Silence would be indistinguishable from "nobody".
  expect(getByText("recommendations.appliesToAll")).toBeTruthy();
});

it("names the workers when appliesTo is present", async () => {
  const { getByText, queryByText } = await render(
    <MitigationRow
      mitigation={mitigation({ appliesTo: ["w-1", "w-2"] })}
      workerNameFor={(id) => (id === "w-1" ? "Meng Hui" : "Siti")}
    />,
  );

  expect(getByText("Meng Hui, Siti")).toBeTruthy();
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

it("renders a pre-#205 mitigation without inventing any of the new fields", async () => {
  const { queryByText, getByText } = await render(<MitigationRow mitigation={mitigation()} />);

  /* The action still renders. The code resolves through `actions.*` with the server prose as the
     defaultValue, which the stub above renders as "key:default" — the point being that the label
     comes from the code, not from parsing the prose. */
  expect(getByText("actions.REST_15_MIN_HOURLY:Rest 15 minutes every hour")).toBeTruthy();
  expect(queryByText("recommendations.originMandatory")).toBeNull();
  expect(queryByText("recommendations.originAdvisory")).toBeNull();
  expect(queryByText("recommendations.ruleReference")).toBeNull();
});
