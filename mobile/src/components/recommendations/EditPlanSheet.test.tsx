/**
 * A supervisor cannot strike out a policy-required action (SCRUM-118 review follow-up).
 *
 * This is the failure the SCRUM-118 design exists to prevent, and it is quiet: a supervisor
 * narrowing a plan drops a MANDATORY row, the crew works without a control the policy engine
 * required, and the record shows a plan somebody approved. Nothing else on the client would catch
 * it — the server accepts an edited plan that merely omits a mitigation.
 *
 * @author Justin Chua
 */
import { render } from "@testing-library/react-native";

import EditPlanSheet from "./EditPlanSheet";
import type { Mitigation } from "@/types/domain";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: {
      background: "#FFFFFF",
      surface: "#FFFFFF",
      border: "#CCCCCC",
      danger: "#C71A34",
      textSecondary: "#4A4A4A",
      textPrimary: "#000000",
    },
    metrics: { borderWidth: 1, radius: 12, minTouchTarget: 44 },
    highContrast: false,
    fontScale: 1,
  }),
}));

/* The sheet renders AppButton, which reads the reduce-motion preference out of the store. Mocked
   rather than wrapping in a Provider: the store is not what these tests are about, and standing a
   real one up would couple a presentational assertion to every slice's initial state. */
jest.mock("@/hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
  useSystemReduceMotion: () => false,
  useReduceMotionPreference: () => false,
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${Object.values(vars).join(",")}` : key,
    i18n: { language: "en" },
  }),
}));

function mitigation(origin: Mitigation["origin"], action: string): Mitigation {
  return {
    priority: "HIGH",
    action,
    rationale: null,
    estimatedImpact: null,
    actionCode: "REST_15_MIN_HOURLY",
    category: "REST",
    origin,
    ruleReference: origin === "MANDATORY" ? "HS-33-HEAVY" : null,
    appliesTo: null,
    timing: null,
  };
}

const noop = () => {};

it("offers no remove control on a required action, and says why", async () => {
  const { queryAllByText, getByText } = await render(
    <EditPlanSheet
      visible
      mitigations={[mitigation("MANDATORY", "Rest 15 minutes every hour")]}
      saving={false}
      onCancel={noop}
      onSend={noop}
    />,
  );

  // Absent rather than disabled: the supervisor is not being denied something they might
  // otherwise do — this was never theirs to remove.
  expect(queryAllByText("recommendations.removeAction")).toHaveLength(0);
  expect(getByText("recommendations.requiredCannotRemove")).toBeTruthy();
});

it("still lets an advisory action be removed", async () => {
  const { queryAllByText, queryByText } = await render(
    <EditPlanSheet
      visible
      mitigations={[mitigation("ADVISORY", "Move heavy work to after 16:00")]}
      saving={false}
      onCancel={noop}
      onSend={noop}
    />,
  );

  // The whole point of the origin field is that these two are treated differently.
  expect(queryAllByText("recommendations.removeAction")).toHaveLength(1);
  expect(queryByText("recommendations.requiredCannotRemove")).toBeNull();
});

it("keeps a pre-#205 mitigation removable, since it claims no origin", async () => {
  const { queryAllByText } = await render(
    <EditPlanSheet
      visible
      mitigations={[mitigation(null, "Drink water hourly")]}
      saving={false}
      onCancel={noop}
      onSend={noop}
    />,
  );

  // Treating an absent origin as mandatory would freeze every plan drafted before #205.
  expect(queryAllByText("recommendations.removeAction")).toHaveLength(1);
});
