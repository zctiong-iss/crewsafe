import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConditionsTrendChart } from "./ConditionsTrendChart";

describe("ConditionsTrendChart history states", () => {
  it("shows history loading before enough points are available", () => {
    render(<ConditionsTrendChart points={[]} historyState="loading" />);

    expect(screen.getByText("Loading the last 4 hours of WBGT readings...")).toBeInTheDocument();
  });

  it("explains when the four-hour window has no readings", () => {
    render(<ConditionsTrendChart points={[]} historyState="ready" />);

    expect(screen.getByText("No WBGT readings in the last 4 hours.")).toBeInTheDocument();
  });

  it("explains why one reading cannot form a trend line", () => {
    render(
      <ConditionsTrendChart
        points={[{ observedAt: "2026-08-20T08:45:00Z", wbgt: 29.1 }]}
        historyState="ready"
      />,
    );

    expect(screen.getByText("One WBGT reading is available; another is needed to plot a trend line."))
      .toBeInTheDocument();
  });
});
