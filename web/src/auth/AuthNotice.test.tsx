/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthNotice } from "./AuthNotice";
import "@testing-library/jest-dom/vitest";

describe("AuthNotice — status region semantics (SCRUM-420 / S6819)", () => {
  it("renders the busy message as an <output> status region, keeping the decorative pulse aria-hidden", () => {
    render(<AuthNotice title="Signing in" body="One moment…" busy />);

    const status = screen.getByText("Working");
    expect(status.tagName).toBe("OUTPUT");
    expect(status).toHaveClass("auth-notice__busy");

    const pulse = status.querySelector(".auth-notice__pulse");
    expect(pulse).not.toBeNull();
    expect(pulse).toHaveAttribute("aria-hidden", "true");
  });
});
