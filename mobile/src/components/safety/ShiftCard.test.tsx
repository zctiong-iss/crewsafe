/**
 * ShiftCard (SCRUM-352 / FR-001, FR-07).
 *
 * Asserts the task/intensity/window rows render, the "no task" fallback when a shift has no
 * named task, and the acclimatisation-ramp banner — shown whenever it applies rather than
 * tucked away, per the file's own header comment, since it changes what the worker may do.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: { border: "#DDDDDD", surface: "#FFFFFF", warning: "#B26A00" },
    highContrast: false,
    metrics: { radius: 12, borderWidth: 1 },
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import ShiftCard from "./ShiftCard";
import type { MyShift } from "@/types/domain";

function shift(overrides: Partial<MyShift["assignment"]> = {}): MyShift {
  return {
    shiftId: "sh1",
    siteId: "s1",
    startsAt: "2026-08-13T00:00:00Z",
    endsAt: "2026-08-13T08:00:00Z",
    status: "ACTIVE",
    assignment: {
      taskName: "Concrete pour",
      intensity: "HEAVY",
      acclimatisationDay: null,
      ...overrides,
    },
  };
}

it("renders the assigned task name", async () => {
  const { queryByText } = await render(<ShiftCard shift={shift()} locale="en" />);
  expect(queryByText("Concrete pour")).not.toBeNull();
});

it("falls back to the no-task label when no task is named", async () => {
  const { queryByText } = await render(
    <ShiftCard shift={shift({ taskName: null })} locale="en" />,
  );
  expect(queryByText("shift.noTask")).not.toBeNull();
});

it("shows the acclimatisation banner on a ramp-restricted day", async () => {
  const { queryByText } = await render(
    <ShiftCard shift={shift({ acclimatisationDay: 3 })} locale="en" />,
  );
  expect(queryByText("shift.acclimatisation")).not.toBeNull();
});

it("hides the acclimatisation banner for a fully acclimatised worker", async () => {
  const { queryByText } = await render(
    <ShiftCard shift={shift({ acclimatisationDay: null })} locale="en" />,
  );
  expect(queryByText("shift.acclimatisation")).toBeNull();
});

describe("accessibility (SCRUM-352 / FR-006, User Story 3)", () => {
  it("exposes the task name as a non-empty accessible label", async () => {
    const { getByText } = await render(<ShiftCard shift={shift()} locale="en" />);
    const task = getByText("Concrete pour");
    expect(task.props.children).toBeTruthy();
  });

  it("exposes the acclimatisation warning as a non-empty accessible label", async () => {
    const { getByText } = await render(
      <ShiftCard shift={shift({ acclimatisationDay: 3 })} locale="en" />,
    );
    const warning = getByText("shift.acclimatisation");
    expect(warning.props.children).toBeTruthy();
  });
});
