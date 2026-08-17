/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionTimeout } from "./useSessionTimeout";
import {
  ABSOLUTE_TIMEOUT_MS,
  ABSOLUTE_WARNING_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
} from "./sessionPolicy";

function Harness({ onExpire, absoluteDeadline }: {
  onExpire: () => void;
  absoluteDeadline: number;
}) {
  const { warning, continueSession } = useSessionTimeout({
    active: true,
    absoluteDeadline,
    onExpire,
  });
  return (
    <div>
      <span>{warning?.kind ?? "none"}</span>
      <button type="button" onClick={continueSession}>Continue</button>
    </div>
  );
}

describe("useSessionTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("warns two minutes before idle expiry and can extend only the idle deadline", () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 7, 10);
    vi.setSystemTime(start);
    const onExpire = vi.fn();
    render(<Harness onExpire={onExpire} absoluteDeadline={start + ABSOLUTE_TIMEOUT_MS} />);

    act(() => vi.advanceTimersByTime(IDLE_TIMEOUT_MS - IDLE_WARNING_MS + 1));
    expect(screen.getByText("idle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("none")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 1));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("ordinary user activity resets idle time", () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 7, 10);
    vi.setSystemTime(start);
    const onExpire = vi.fn();
    render(<Harness onExpire={onExpire} absoluteDeadline={start + ABSOLUTE_TIMEOUT_MS} />);

    act(() => vi.advanceTimersByTime(20 * 60_000));
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
    act(() => vi.advanceTimersByTime(20 * 60_000));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("shows an absolute warning that Continue cannot extend", () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 7, 10);
    vi.setSystemTime(start);
    const onExpire = vi.fn();
    render(<Harness onExpire={onExpire} absoluteDeadline={start + 10 * 60_000} />);

    act(() => vi.advanceTimersByTime(5 * 60_000 + 1));
    expect(screen.getByText("absolute")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("absolute")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5 * 60_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  // SCRUM-420 / S3358 — locks in precedence (absolute checked before idle) before the
  // nested-ternary `nextWarning` computation is extracted.
  it("prefers the absolute warning when both the idle and absolute windows are active at once", () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 7, 10);
    vi.setSystemTime(start);
    const onExpire = vi.fn();
    // idleDeadline = start + IDLE_TIMEOUT_MS (30min); its warning window opens at 28min.
    // absoluteDeadline is set to 29min so its warning window (24min–29min) overlaps the
    // idle warning window (28min–30min) in the [28min, 29min) range.
    const absoluteDeadline = start + IDLE_TIMEOUT_MS - 60_000;
    render(<Harness onExpire={onExpire} absoluteDeadline={absoluteDeadline} />);

    const overlapMoment = IDLE_TIMEOUT_MS - IDLE_WARNING_MS + 30_000; // 28.5min
    expect(overlapMoment).toBeLessThan(absoluteDeadline - start);
    expect(overlapMoment).toBeGreaterThanOrEqual(absoluteDeadline - start - ABSOLUTE_WARNING_MS);

    act(() => vi.advanceTimersByTime(overlapMoment));
    expect(screen.getByText("absolute")).toBeInTheDocument();
    expect(onExpire).not.toHaveBeenCalled();
  });
});
