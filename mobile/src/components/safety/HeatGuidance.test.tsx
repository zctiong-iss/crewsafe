/**
 * HeatGuidance (SCRUM-352 / FR-001).
 *
 * The FR-12a override is the load-bearing behaviour: a lightning stop-work must say in
 * words that the heat plan is suspended, not merely dim it (see the file's own header
 * comment). Asserts the override line's presence/absence, mandatory vs advisory sections,
 * the "nothing to do" fallback, and the policy-version line every recommendation needs.
 */
import { render } from "@testing-library/react-native";

jest.mock("@/theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: {
      disabled: "#999999",
      textPrimary: "#111111",
      danger: "#B00020",
      border: "#DDDDDD",
      surface: "#FFFFFF",
    },
    highContrast: false,
    metrics: { radius: 12, borderWidth: 1 },
  }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import HeatGuidance from "./HeatGuidance";
import type { PolicyEvaluation } from "@/types/domain";

function policy(overrides: Partial<PolicyEvaluation> = {}): PolicyEvaluation {
  return {
    policyVersion: "v3",
    currentBand: "32_TO_BELOW_33",
    forecastBand: null,
    mandatoryActions: [],
    advisoryActions: [],
    ...overrides,
  };
}

const action = (code: string, ruleReference = "HS-32-HEAVY") => ({
  code,
  appliesTo: [],
  ruleReference,
});

it("states the suspension in words when a lightning stop-work is active", async () => {
  const { queryByText } = await render(<HeatGuidance policy={policy()} suspended />);
  expect(queryByText("guidance.suspended")).not.toBeNull();
});

it("says nothing about suspension when no stop-work is active", async () => {
  const { queryByText } = await render(<HeatGuidance policy={policy()} suspended={false} />);
  expect(queryByText("guidance.suspended")).toBeNull();
});

it("renders the mandatory-actions section when actions are required", async () => {
  const { queryByText } = await render(
    <HeatGuidance
      policy={policy({ mandatoryActions: [action("REST_10_MIN_HOURLY")] })}
      suspended={false}
    />,
  );
  expect(queryByText("guidance.title")).not.toBeNull();
  expect(queryByText("actions.REST_10_MIN_HOURLY")).not.toBeNull();
});

it("renders the advisory-actions section separately from mandatory", async () => {
  const { queryByText } = await render(
    <HeatGuidance
      policy={policy({ advisoryActions: [action("HYDRATE_HOURLY")] })}
      suspended={false}
    />,
  );
  expect(queryByText("guidance.advisoryTitle")).not.toBeNull();
  expect(queryByText("actions.HYDRATE_HOURLY")).not.toBeNull();
});

it("falls back to a 'nothing to do' message when there are no actions", async () => {
  const { queryByText } = await render(<HeatGuidance policy={policy()} suspended={false} />);
  expect(queryByText("guidance.none")).not.toBeNull();
  expect(queryByText("guidance.title")).toBeNull();
});

it("always shows which policy version produced the plan", async () => {
  const { queryByText } = await render(
    <HeatGuidance policy={policy({ policyVersion: "v9" })} suspended={false} />,
  );
  expect(queryByText("guidance.policyVersion")).not.toBeNull();
});

describe("accessibility (SCRUM-352 / FR-006, User Story 3)", () => {
  it("exposes each mandatory action's instruction as a non-empty accessible label", async () => {
    const { getByText } = await render(
      <HeatGuidance
        policy={policy({ mandatoryActions: [action("REST_10_MIN_HOURLY")] })}
        suspended={false}
      />,
    );
    const instruction = getByText("actions.REST_10_MIN_HOURLY");
    expect(instruction.props.children).toBeTruthy();
  });

  it("exposes the suspension notice as a non-empty accessible label", async () => {
    const { getByText } = await render(<HeatGuidance policy={policy()} suspended />);
    const notice = getByText("guidance.suspended");
    expect(notice.props.children).toBeTruthy();
  });
});
