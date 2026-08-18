/**
 * Who may end a shift, and when (SCRUM-442).
 *
 * Three permanent actions sit on this screen — close, cancel and delete — and two rules decide
 * what is offered. Both are the kind that silently stop holding: a role check that is one
 * refactor away from letting a worker end a shift, and a time check that only misbehaves in
 * the minutes either side of `endsAt`. Neither shows up in a manual pass, so they are pinned
 * here.
 *
 * A real store with the real `shiftsSlice` reducer, mocking only the network boundary, so the
 * thunks and their `condition` guards are exercised rather than imitated.
 *
 * @author Justin Chua
 */
import { configureStore } from "@reduxjs/toolkit";
import { Alert } from "react-native";
import { Provider } from "react-redux";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));

jest.mock("@react-navigation/native", () => ({
  useRoute: () => ({ params: { siteId: "site-1", shiftId: "shift-1" } }),
  useNavigation: () => ({ goBack: jest.fn(), setOptions: jest.fn(), getParent: () => null }),
}));

const mockCancelRequest = jest.fn();
const mockCloseRequest = jest.fn();
jest.mock("@/api/endpoints/shifts", () => ({
  cancelShift: (...a: unknown[]) => mockCancelRequest(...a),
  closeShift: (...a: unknown[]) => mockCloseRequest(...a),
  deleteShift: jest.fn().mockResolvedValue(undefined),
  updateShift: jest.fn(),
  updateAssignment: jest.fn(),
  addAssignment: jest.fn(),
  removeAssignment: jest.fn(),
  fetchShifts: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/store/reducers/wellbeingSlice", () => ({
  loadCrewWellbeing: () => ({ type: "wellbeing/noop" }),
}));
jest.mock("@/store/reducers/uiSlice", () => ({
  showToast: (p: unknown) => ({ type: "ui/showToast", payload: p }),
}));
jest.mock("@/store/reducers/recommendationsSlice", () => ({
  generateRecommendation: () => ({ type: "recommendations/noop" }),
}));

import shiftsReducer from "@/store/reducers/shiftsSlice";
import ShiftDetailScreen from "./ShiftDetailScreen";
import type { CurrentUser, Shift } from "@/types/domain";

const SUPERVISOR: CurrentUser = {
  id: "sup-1",
  username: "supervisor1",
  displayName: "Supervisor One",
  role: "SUPERVISOR",
  siteIds: ["site-1"],
};
const WORKER: CurrentUser = { ...SUPERVISOR, role: "WORKER" };
const SAFETY_MANAGER: CurrentUser = { ...SUPERVISOR, role: "SAFETY_MANAGER" };

const HOUR = 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: "shift-1",
    siteId: "site-1",
    startsAt: iso(-2 * HOUR),
    endsAt: iso(4 * HOUR),
    status: "ACTIVE",
    assignments: [],
    ...overrides,
  } as Shift;
}

async function renderScreen(user: CurrentUser, current: Shift = shift()) {
  const store = configureStore({
    reducer: {
      shifts: shiftsReducer,
      auth: (state = { user }) => state,
      wellbeing: (state = { crew: [] }) => state,
      recommendations: (state = { generating: false }) => state,
    },
    preloadedState: {
      shifts: {
        ...(shiftsReducer(undefined, { type: "@@INIT" }) as ReturnType<typeof shiftsReducer>),
        shifts: [current],
      },
    },
  });

  // RNTL 14 renders asynchronously, so the queries have to be awaited out before spreading.
  const queries = await render(
    <Provider store={store}>
      <ShiftDetailScreen />
    </Provider>,
  );

  return { store, ...queries };
}

beforeEach(() => {
  mockCancelRequest.mockReset().mockResolvedValue(shift({ status: "CANCELLED" }));
  mockCloseRequest.mockReset().mockResolvedValue(shift({ status: "CLOSED" }));
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("who may end a shift", () => {
  it("offers close and cancel to a supervisor", async () => {
    const { queryByText } = await renderScreen(SUPERVISOR);

    expect(queryByText("shifts.closeButton")).not.toBeNull();
    expect(queryByText("shifts.cancelButton")).not.toBeNull();
  });

  it.each([
    ["a worker", WORKER],
    ["a safety manager", SAFETY_MANAGER],
  ])("offers neither to %s", async (_name, user) => {
    /*
     * The server refuses either way, so this is defence in depth — but a control that is only
     * ever refused teaches a supervisor that the app is broken. SAFETY_MANAGER is included
     * deliberately: the backend admits it for close but not for cancel, and mobile offers
     * managers no shift controls at all until that disagreement is settled.
     */
    const { queryByText } = await renderScreen(user);

    expect(queryByText("shifts.closeButton")).toBeNull();
    expect(queryByText("shifts.cancelButton")).toBeNull();
  });

  it.each(["CLOSED", "CANCELLED"] as const)("offers neither on a %s shift", async (status) => {
    // Terminal is terminal. There is no un-close and no un-cancel, so both controls could only
    // be refused, and showing them would suggest the shift can be moved back.
    const { queryByText } = await renderScreen(SUPERVISOR, shift({ status }));

    expect(queryByText("shifts.closeButton")).toBeNull();
    expect(queryByText("shifts.cancelButton")).toBeNull();
  });
});

describe("close, which is refused before the shift ends", () => {
  it("is disabled with an explanation while the shift is still running", async () => {
    const { getByText, queryByText } = await renderScreen(SUPERVISOR, shift({ endsAt: iso(HOUR) }));

    expect(getByText("shifts.closeButton").props.accessibilityState?.disabled ?? true).toBe(true);
    // Disabled rather than hidden, and it says why — otherwise a supervisor looking for a way
    // to finish a running shift reaches for Cancel, which means something different forever.
    expect(queryByText("shifts.closeNotYetEnded")).not.toBeNull();
  });

  it("sends nothing when the disabled control is pressed anyway", async () => {
    const { getByText } = await renderScreen(SUPERVISOR, shift({ endsAt: iso(HOUR) }));

    await fireEvent.press(getByText("shifts.closeButton"));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockCloseRequest).not.toHaveBeenCalled();
  });

  it("is enabled once endsAt has passed, and the explanation goes away", async () => {
    const { getByText, queryByText } = await renderScreen(
      SUPERVISOR,
      shift({ startsAt: iso(-8 * HOUR), endsAt: iso(-HOUR) }),
    );

    expect(getByText("shifts.closeButton").props.accessibilityState?.disabled ?? false).toBe(false);
    expect(queryByText("shifts.closeNotYetEnded")).toBeNull();
  });

  it("confirms before closing, and takes the server's status", async () => {
    const ended = shift({ startsAt: iso(-8 * HOUR), endsAt: iso(-HOUR) });
    const { getByText, store } = await renderScreen(SUPERVISOR, ended);

    await fireEvent.press(getByText("shifts.closeButton"));

    // Confirmed, not immediate. Closing cannot be undone.
    expect(Alert.alert).toHaveBeenCalled();
    expect(mockCloseRequest).not.toHaveBeenCalled();

    const confirm = (Alert.alert as jest.Mock).mock.calls[0][2].find(
      (button: { style?: string }) => button.style !== "cancel",
    );
    // Invoked directly rather than through a press: the confirm lives in a native Alert,
    // which renders nothing for the test tree to find.
    await act(async () => confirm.onPress());

    await waitFor(() => expect(store.getState().shifts.shifts[0].status).toBe("CLOSED"));
    expect(mockCloseRequest).toHaveBeenCalledWith("site-1", "shift-1");
  });
});

describe("cancel", () => {
  it("asks for a reason before sending anything", async () => {
    const { getByText } = await renderScreen(SUPERVISOR);

    await fireEvent.press(getByText("shifts.cancelButton"));

    // The sheet, not a request. The reason is required server-side and lands in the audit
    // trail, so there is no path from this button straight to a cancellation.
    expect(getByText("shifts.cancelTitle")).not.toBeNull();
    expect(mockCancelRequest).not.toHaveBeenCalled();
  });

  it("sends the reason and takes the server's status", async () => {
    const { getByText, getByLabelText, store } = await renderScreen(SUPERVISOR);

    await fireEvent.press(getByText("shifts.cancelButton"));
    await fireEvent.changeText(getByLabelText("shifts.cancelReasonLabel"), "Lightning risk");
    await fireEvent.press(getByText("shifts.cancelConfirm"));

    await waitFor(() => expect(store.getState().shifts.shifts[0].status).toBe("CANCELLED"));
    expect(mockCancelRequest).toHaveBeenCalledWith("site-1", "shift-1", "Lightning risk");
  });

  it("leaves the shift alone when the server refuses", async () => {
    // Someone else ended it first. The shift is whatever the server says it is; showing a
    // cancelled shift that is in fact still running would stand a crew down on a wrong screen.
    mockCancelRequest.mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 }));
    const { getByText, getByLabelText, store } = await renderScreen(SUPERVISOR);

    await fireEvent.press(getByText("shifts.cancelButton"));
    await fireEvent.changeText(getByLabelText("shifts.cancelReasonLabel"), "Lightning risk");
    await fireEvent.press(getByText("shifts.cancelConfirm"));

    await waitFor(() => expect(store.getState().shifts.endingId).toBeNull());
    expect(store.getState().shifts.shifts[0].status).toBe("ACTIVE");
  });
});
