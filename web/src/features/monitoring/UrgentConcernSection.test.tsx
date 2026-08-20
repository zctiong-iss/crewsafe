import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectNoA11yViolations } from "@/test/a11y";
import type { Concern } from "@/api/concernStream";
import { UrgentConcernSection } from "./UrgentConcernSection";
import "@testing-library/jest-dom/vitest";

const oneConcern: Concern = {
  id: "550e8400-e29b-41d4-a716-446655440001",
  shiftId: "550e8400-e29b-41d4-a716-446655440002",
  workerId: "550e8400-e29b-41d4-a716-446655440003",
  symptoms: ["DIZZINESS", "MUSCLE_CRAMPS"],
  note: "I need help",
  status: "OPEN",
  raisedAt: "2026-08-20T08:00:00Z",
  acknowledgedAt: null,
};

describe("UrgentConcernSection", () => {
  it("renders urgent details and does not offer acknowledgement", () => {
    render(<UrgentConcernSection concerns={[oneConcern]} connectionState="live" hasSnapshot />);
    expect(screen.getByRole("heading", { name: /Urgent worker concerns/i })).toBeInTheDocument();
    expect(screen.getByText("Worker 550e8400")).toBeInTheDocument();
    expect(screen.getByText("Dizziness, Muscle cramps")).toBeInTheDocument();
    expect(screen.getByText(/Worker's own words \(not translated\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /acknowledge/i })).not.toBeInTheDocument();
  });

  it("shows feed-state messages until a live empty snapshot hides the section", () => {
    const { rerender } = render(
      <UrgentConcernSection concerns={[]} connectionState="connecting" hasSnapshot={false} />,
    );
    expect(screen.getByText("Connecting to workers' feed...")).toBeInTheDocument();
    rerender(
      <UrgentConcernSection concerns={[]} connectionState="degraded" hasSnapshot />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/last complete update/i);
    rerender(<UrgentConcernSection concerns={[]} connectionState="live" hasSnapshot />);
    expect(screen.queryByRole("heading", { name: /Urgent worker concerns/i })).not.toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <UrgentConcernSection concerns={[oneConcern]} connectionState="live" hasSnapshot />,
    );
    await expectNoA11yViolations(container);
  });
});
