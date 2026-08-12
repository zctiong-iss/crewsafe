/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionTimeout } from "./useSessionTimeout";
import {
  ABSOLUTE_TIMEOUT_MS,
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
});
