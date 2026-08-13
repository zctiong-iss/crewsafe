/**
 * WellbeingLogCard (SCRUM-352 / FR-005, US-11).
 *
 * One tap, no follow-up questions — the feedback (a timestamp) is the whole point (see the
 * file's own header comment). Asserts the not-yet-logged vs. just-logged subtitle per
 * action, the in-flight/loading state per button, and that a failure is reported inline
 * rather than as a modal that would take the button out from under the thumb.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
// The failure banner renders through MessageBanner -> AnimatedIcon, which reads the
// reduce-motion preference out of the store.
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
}));

import WellbeingLogCard from "./WellbeingLogCard";

const baseProps = {
  loggingType: null,
  errorKey: null,
  onLog: jest.fn(),
  onRaiseConcern: jest.fn(),
};

it("shows not-logged-yet for both actions before anything is logged", async () => {
  const { getAllByText } = await render(<WellbeingLogCard justLogged={{}} {...baseProps} />);
  expect(getAllByText("wellbeing.notLoggedYet")).toHaveLength(2);
});

it("shows when rest was last logged, from the server's own timestamp", async () => {
  const { queryByText, getByText } = await render(
    <WellbeingLogCard justLogged={{ REST: "2026-08-13T02:00:00Z" }} {...baseProps} />,
  );
  expect(queryByText("wellbeing.loggedAt")).not.toBeNull();
  // Hydration is unaffected by rest having been logged.
  expect(getByText("wellbeing.notLoggedYet")).not.toBeNull();
});

it("shows a logging state only on the button currently in flight", async () => {
  const { getByText, queryAllByText } = await render(
    <WellbeingLogCard justLogged={{}} {...baseProps} loggingType="REST" />,
  );
  expect(getByText("wellbeing.logging")).not.toBeNull();
  expect(queryAllByText("wellbeing.logHydration")).toHaveLength(1);
});

it("reports a failure inline rather than as a modal", async () => {
  const { queryByText } = await render(
    <WellbeingLogCard justLogged={{}} {...baseProps} errorKey="errors.network" />,
  );
  expect(queryByText("wellbeing.logFailed")).not.toBeNull();
});

it("offers a way to raise a concern independent of the two logging buttons", async () => {
  const { queryByText } = await render(<WellbeingLogCard justLogged={{}} {...baseProps} />);
  expect(queryByText("wellbeing.raiseConcern")).not.toBeNull();
});
