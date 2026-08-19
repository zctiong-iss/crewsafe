import { emergencyStopCompatibilityValue } from "./policyCompatibility";

describe("policy compatibility", () => {
  it("preserves the legacy emergency-stop value from the wire model", () => {
    expect(
      emergencyStopCompatibilityValue({ wbgtEmergencyStop: 33 } as never),
    ).toBe(33);
  });

  it.each([undefined, "33", Number.NaN])("returns the safe compatibility default for %p", (value) => {
    expect(
      emergencyStopCompatibilityValue({ wbgtEmergencyStop: value } as never),
    ).toBe(0);
  });
});
