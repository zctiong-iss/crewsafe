/**
 * CrewWellbeingRow (SCRUM-352 / FR-005, US-11).
 *
 * The absent row is the important one — a worker with nothing logged renders "nothing
 * logged" rather than being silently skipped (see the file's own header comment). Asserts
 * that degraded (nothing-logged) state, the populated state, and the not-yet-logged
 * per-metric fallback, plus the INSTRUCTED-vs-self-logged distinction.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({ colors: { border: "#DDDDDD" } }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import CrewWellbeingRow from "./CrewWellbeingRow";
import type { CrewWellbeingRow as CrewWellbeingRowData } from "@/types/domain";

function row(overrides: Partial<CrewWellbeingRowData> = {}): CrewWellbeingRowData {
  return {
    workerId: "w1",
    lastRestAt: "2026-08-13T02:00:00Z",
    lastRestSource: "SELF",
    lastHydrationAt: "2026-08-13T02:05:00Z",
    restCount: 2,
    hydrationCount: 3,
    ...overrides,
  };
}

it("shows the degraded 'nothing logged' state for a worker with no row at all", async () => {
  const { queryByText } = await render(
    <CrewWellbeingRow workerName="Worker One" row={null} locale="en" />,
  );
  expect(queryByText("wellbeing.nothingLogged")).not.toBeNull();
});

it("shows rest and hydration summaries for a populated row", async () => {
  const { queryByText } = await render(
    <CrewWellbeingRow workerName="Worker One" row={row()} locale="en" />,
  );
  expect(queryByText("wellbeing.lastRest")).not.toBeNull();
  expect(queryByText("wellbeing.lastDrink")).not.toBeNull();
});

it("distinguishes an instructed rest from a self-logged one", async () => {
  const { queryByText } = await render(
    <CrewWellbeingRow
      workerName="Worker One"
      row={row({ lastRestSource: "INSTRUCTED" })}
      locale="en"
    />,
  );
  expect(queryByText(/wellbeing\.instructed/)).not.toBeNull();
});

it("falls back to not-logged-yet for a metric with no timestamp", async () => {
  const { getAllByText } = await render(
    <CrewWellbeingRow
      workerName="Worker One"
      row={row({ lastRestAt: null, lastHydrationAt: null })}
      locale="en"
    />,
  );
  // Both rest and hydration fall back to the same key when neither has a timestamp.
  expect(getAllByText("wellbeing.notLoggedYet")).toHaveLength(2);
});
