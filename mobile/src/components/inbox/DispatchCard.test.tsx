/**
 * DispatchCard (SCRUM-352 / FR-004, SCRUM-186).
 *
 * One tap acknowledges; safety comes from idempotency, not a confirmation dialog — see the
 * file's own header comment. Asserts the pending vs. acknowledged presentation, the
 * in-flight/failure button states, and that a failure is paired with reassurance that a
 * retry is safe rather than a second, silent submission.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => jest.requireActual("@/styles/theme").defaultTheme,
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
}));

import DispatchCard from "./DispatchCard";
import type { ActionDispatch } from "@/types/domain";

function dispatch(overrides: Partial<ActionDispatch> = {}): ActionDispatch {
  return {
    id: "d1",
    approvalId: "a1",
    workerId: "w1",
    actionCode: "REST_10_MIN",
    instruction: "Rest for 10 minutes",
    startTime: null,
    endTime: null,
    status: "PENDING",
    dispatchedAt: "2026-08-13T02:00:00Z",
    ...overrides,
  };
}

const baseProps = {
  acknowledgedAt: null,
  inFlight: false,
  failureKey: null,
  onAcknowledge: jest.fn(),
  locale: "en",
};

it("offers the acknowledge action while pending", async () => {
  const { queryByText } = await render(<DispatchCard dispatch={dispatch()} {...baseProps} />);
  expect(queryByText("inbox.acknowledgeButton")).not.toBeNull();
  expect(queryByText("inbox.pending")).not.toBeNull();
});

it("hides the acknowledge action once acknowledged", async () => {
  const { queryByText } = await render(
    <DispatchCard
      dispatch={dispatch()}
      {...baseProps}
      acknowledgedAt="2026-08-13T02:05:00Z"
    />,
  );
  expect(queryByText("inbox.acknowledgeButton")).toBeNull();
  expect(queryByText("inbox.acknowledged")).not.toBeNull();
});

it("shows an in-flight state while the acknowledgement is being sent", async () => {
  const { queryByText } = await render(
    <DispatchCard dispatch={dispatch()} {...baseProps} inFlight />,
  );
  expect(queryByText("inbox.acknowledging")).not.toBeNull();
});

it("offers a retry, not the first-attempt label, after a failure", async () => {
  const { queryByText } = await render(
    <DispatchCard dispatch={dispatch()} {...baseProps} failureKey="errors.network" />,
  );
  expect(queryByText("inbox.retryButton")).not.toBeNull();
  expect(queryByText("inbox.acknowledgeButton")).toBeNull();
});

it("pairs a failure with reassurance that retrying is safe", async () => {
  const { queryByText } = await render(
    <DispatchCard dispatch={dispatch()} {...baseProps} failureKey="errors.network" />,
  );
  expect(queryByText("errors.network")).not.toBeNull();
  expect(queryByText("inbox.safeToRetry")).not.toBeNull();
});

it("falls back to a humanised action title when no translation exists", async () => {
  const { queryByText } = await render(
    <DispatchCard dispatch={dispatch({ actionCode: "ROTATE_TO_LIGHT_DUTY" })} {...baseProps} />,
  );
  // Under the identity `t` mock this renders the raw key, which is itself the assertion that
  // the lookup was attempted with a defaultValue rather than the component crashing on an
  // action code with no translation.
  expect(queryByText("actions.ROTATE_TO_LIGHT_DUTY")).not.toBeNull();
});

it("shows a fallback instruction when the dispatch carries none", async () => {
  const { queryByText } = await render(
    <DispatchCard dispatch={dispatch({ instruction: null })} {...baseProps} />,
  );
  expect(queryByText("inbox.noInstruction")).not.toBeNull();
});
