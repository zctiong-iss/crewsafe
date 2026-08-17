/**
 * ShiftListScreen — the crew disclosure (SCRUM-266), covered for the first time.
 *
 * This screen shipped untested, and Phase 3 rewired its crew toggle onto the shared
 * `Disclosure`. The behaviour SCRUM-266 specified is easy to break in that move and nothing
 * would have caught it:
 *
 *   - two shifts can be open AT ONCE. The state is a Set precisely so a supervisor comparing
 *     two crews does not have to close one to read the other. A `Disclosure` holding its own
 *     state would still pass a naive one-card test and fail this.
 *   - an unstaffed shift gets NO toggle. A control that opens onto an empty box is worse than
 *     no control.
 *   - tapping the crew toggle must not open the shift. The card's own press goes to the detail
 *     screen, where editing lives; SCRUM-266 kept them separate on purpose.
 */
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));
jest.mock("@/hooks/useAutoRefresh", () => ({
  useAutoRefresh: () => {},
  REFRESH_INTERVALS: { shifts: 60000 },
}));

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

jest.mock("@/store/reducers/shiftsSlice", () => ({
  loadShifts: () => ({ type: "shifts/noop" }),
  siteSelected: (id: string) => ({ type: "shifts/siteSelected", payload: id }),
}));
jest.mock("@/auth/authMode", () => ({ isMockApi: () => false }));
jest.mock("@/api/mock/shifts", () => ({
  getForceForbidden: () => false,
  setForceForbidden: jest.fn(),
}));

import ShiftListScreen from "./ShiftListScreen";

const STAFFED = {
  id: "shift-1",
  siteId: "site-1",
  status: "PLANNED",
  startsAt: "2026-08-17T01:00:00Z",
  endsAt: "2026-08-17T09:00:00Z",
  assignments: [
    { id: "a-1", workerId: "w-1", taskName: "Rebar", intensity: "HEAVY", acclimatisationDay: null },
  ],
};

const ALSO_STAFFED = {
  ...STAFFED,
  id: "shift-2",
  assignments: [
    { id: "a-2", workerId: "w-2", taskName: "Formwork", intensity: "LIGHT", acclimatisationDay: 3 },
  ],
};

const UNSTAFFED = { ...STAFFED, id: "shift-3", assignments: [] };

function buildStore(shifts: unknown[]) {
  return configureStore({
    reducer: {
      shifts: (
        state = {
          status: "ready",
          sites: [{ id: "site-1", name: "Site One" }],
          selectedSiteId: "site-1",
          shifts,
          errorKey: null,
          requestId: null,
          refreshing: false,
          workers: [
            { id: "w-1", displayName: "Meng Hui" },
            { id: "w-2", displayName: "Siti" },
          ],
        } as unknown,
      ) => state,
      auth: (state = { user: { id: "sup-1", role: "SUPERVISOR", siteIds: ["site-1"] } } as unknown) =>
        state,
    },
  });
}

function renderScreen(shifts: unknown[]) {
  return render(
    <Provider store={buildStore(shifts)}>
      <ShiftListScreen />
    </Provider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

it("hides the crew until the toggle is pressed", async () => {
  const { queryByText, getByLabelText } = await renderScreen([STAFFED]);

  expect(queryByText("Meng Hui")).toBeNull();

  await fireEvent.press(getByLabelText("shifts.showCrew"));
  expect(queryByText("Meng Hui")).not.toBeNull();
});

it("hides the crew again on a second press", async () => {
  const { queryByText, getByLabelText } = await renderScreen([STAFFED]);

  await fireEvent.press(getByLabelText("shifts.showCrew"));
  await fireEvent.press(getByLabelText("shifts.hideCrew"));

  expect(queryByText("Meng Hui")).toBeNull();
});

it("keeps two shifts open at once", async () => {
  /*
   * The reason the state is a Set. A supervisor comparing two crews should not have to close
   * one to read the other — that was the whole argument for putting this inline rather than
   * on the detail screen.
   */
  const { queryByText, getAllByLabelText } = await renderScreen([STAFFED, ALSO_STAFFED]);

  const toggles = getAllByLabelText("shifts.showCrew");
  expect(toggles).toHaveLength(2);

  await fireEvent.press(toggles[0]);
  await fireEvent.press(getAllByLabelText("shifts.showCrew")[0]);

  expect(queryByText("Meng Hui")).not.toBeNull();
  expect(queryByText("Siti")).not.toBeNull();
});

it("gives an unstaffed shift no toggle at all", async () => {
  // A control that opens onto an empty box is worse than no control.
  const { queryByLabelText, queryByText } = await renderScreen([UNSTAFFED]);

  expect(queryByLabelText("shifts.showCrew")).toBeNull();
  expect(queryByText("shifts.unstaffed")).not.toBeNull();
});

it("does not navigate to the shift when the crew toggle is pressed", async () => {
  // The card's own press opens the shift, where editing lives. SCRUM-266 kept the two
  // separate deliberately; a toggle that also navigated would take the edit path away.
  const { getByLabelText } = await renderScreen([STAFFED]);

  await fireEvent.press(getByLabelText("shifts.showCrew"));

  expect(mockNavigate).not.toHaveBeenCalled();
});

it("reports the crew toggle's expanded state to a screen reader", async () => {
  const { getByLabelText } = await renderScreen([STAFFED]);

  const toggle = getByLabelText("shifts.showCrew");
  expect(toggle.props.accessibilityRole).toBe("button");
  expect(toggle.props.accessibilityState.expanded).toBe(false);

  await fireEvent.press(toggle);
  expect(getByLabelText("shifts.hideCrew").props.accessibilityState.expanded).toBe(true);
});
