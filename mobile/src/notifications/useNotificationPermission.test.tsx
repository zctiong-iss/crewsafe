/**
 * The single attempt, and the ways it must not be wasted.
 *
 * iOS shows its notification prompt exactly once per install and a refusal cannot be re-asked
 * from inside the app. Every case here is about not spending that attempt badly: not on a user
 * who has already refused, not on one who has already been asked and said "not now", and not
 * on one who muted notifications themselves.
 *
 * @author Justin Chua
 */
import { Alert } from "react-native";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { renderHook, act } from "@testing-library/react-native";

const mockGetPermission = jest.fn();
const mockRequestPermission = jest.fn();

jest.mock("./notificationClient", () => ({
  getPermission: () => mockGetPermission(),
  requestPermission: () => mockRequestPermission(),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import preferencesReducer from "@/store/reducers/preferencesSlice";
import { useNotificationPermission } from "./useNotificationPermission";

interface Options {
  muted?: boolean;
  rationaleShown?: boolean;
}

async function setup({ muted = false, rationaleShown = false }: Options = {}) {
  const store = configureStore({
    reducer: { preferences: preferencesReducer },
    preloadedState: {
      preferences: {
        ...(preferencesReducer(undefined, { type: "@@INIT" }) as ReturnType<
          typeof preferencesReducer
        >),
        notificationsMuted: muted,
        notificationRationaleShown: rationaleShown,
      },
    },
  });

  // RNTL 14 renders asynchronously, so the hook result has to be awaited out.
  const { result } = await renderHook(() => useNotificationPermission(), {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  });

  return { store, result };
}

/** Answers the rationale dialog by pressing one of its buttons. */
function answerRationale(choice: "accept" | "decline") {
  (Alert.alert as jest.Mock).mockImplementation((_title, _body, buttons) => {
    const button = buttons.find((b: { style?: string }) =>
      choice === "accept" ? b.style !== "cancel" : b.style === "cancel",
    );
    button.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockGetPermission.mockResolvedValue("undetermined");
  mockRequestPermission.mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

it("does not ask again when permission is already granted", async () => {
  mockGetPermission.mockResolvedValue("granted");
  const { result } = await setup();

  await act(async () => {
    await expect(result.current.ensure()).resolves.toBe(true);
  });

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockRequestPermission).not.toHaveBeenCalled();
});

it("does not try once the OS has refused", async () => {
  /*
   * `requestPermission` would resolve false without showing anything, so calling it would make
   * this look like it retries each time when it cannot. Worse, it would put a rationale dialog
   * in front of a prompt that will never appear.
   */
  mockGetPermission.mockResolvedValue("denied");
  const { result } = await setup();

  await act(async () => {
    await expect(result.current.ensure()).resolves.toBe(false);
  });

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockRequestPermission).not.toHaveBeenCalled();
});

it("explains itself before the system prompt, and only asks if that is accepted", async () => {
  answerRationale("accept");
  const { result } = await setup();

  await act(async () => {
    await expect(result.current.ensure()).resolves.toBe(true);
  });

  expect(Alert.alert).toHaveBeenCalled();
  expect(mockRequestPermission).toHaveBeenCalled();
});

it("spends nothing when the explanation is declined", async () => {
  answerRationale("decline");
  const { result } = await setup();

  await act(async () => {
    await expect(result.current.ensure()).resolves.toBe(false);
  });

  // The whole reason the rationale exists: the OS prompt is never reached by someone who has
  // already said no to the idea, so the single attempt survives for a better moment.
  expect(mockRequestPermission).not.toHaveBeenCalled();
});

it("records that it asked, so it does not nag on the next acknowledgement", async () => {
  answerRationale("decline");
  const { store, result } = await setup();

  await act(async () => {
    await result.current.ensure();
  });

  expect(store.getState().preferences.notificationRationaleShown).toBe(true);
});

it("stays quiet on later attempts once the explanation has been shown", async () => {
  const { result } = await setup({ rationaleShown: true });

  await act(async () => {
    await expect(result.current.ensure()).resolves.toBe(false);
  });

  expect(Alert.alert).not.toHaveBeenCalled();
});

it("asks nothing while the user has muted notifications", async () => {
  // Mute beats an undetermined permission. Someone who turned the switch off in Settings has
  // answered a question the OS was never asked.
  const { result } = await setup({ muted: true });

  await act(async () => {
    await expect(result.current.ensure()).resolves.toBe(false);
  });

  expect(Alert.alert).not.toHaveBeenCalled();
});

it("reports notifications as unusable while muted, even with permission granted", async () => {
  mockGetPermission.mockResolvedValue("granted");
  const { result } = await setup({ muted: true });

  await act(async () => {
    await expect(result.current.isEnabled()).resolves.toBe(false);
  });
});
