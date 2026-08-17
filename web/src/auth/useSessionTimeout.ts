/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ABSOLUTE_WARNING_MS,
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  type SessionWarning,
} from "./sessionPolicy";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
const ACTIVITY_THROTTLE_MS = 1_000;

interface SessionTimeoutOptions {
  active: boolean;
  absoluteDeadline: number | null;
  onExpire: () => void;
  now?: () => number;
  activityTarget?: Pick<Document, "addEventListener" | "removeEventListener">;
}

export function useSessionTimeout({
  active,
  absoluteDeadline,
  onExpire,
  now = Date.now,
  activityTarget = document,
}: SessionTimeoutOptions): { warning: SessionWarning | null; continueSession: () => void } {
  const [idleDeadline, setIdleDeadline] = useState<number | null>(null);
  const [warning, setWarning] = useState<SessionWarning | null>(null);
  const lastActivityAt = useRef(0);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!active) {
      setIdleDeadline(null);
      setWarning(null);
      return;
    }
    setIdleDeadline(now() + IDLE_TIMEOUT_MS);
  }, [active, now]);

  useEffect(() => {
    if (!active || idleDeadline === null || absoluteDeadline === null) return;

    let timer: number | undefined;
    const evaluate = () => {
      const current = now();
      const expiresAt = Math.min(idleDeadline, absoluteDeadline);

      if (current >= expiresAt) {
        setWarning(null);
        onExpireRef.current();
        return;
      }

      const computeWarning = (): SessionWarning | null => {
        if (current >= absoluteDeadline - ABSOLUTE_WARNING_MS)
          return { kind: "absolute", expiresAt: absoluteDeadline };
        if (current >= idleDeadline - IDLE_WARNING_MS)
          return { kind: "idle", expiresAt: idleDeadline };
        return null;
      };
      const nextWarning = computeWarning();

      setWarning((previous) =>
        previous?.kind === nextWarning?.kind && previous?.expiresAt === nextWarning?.expiresAt
          ? previous
          : nextWarning,
      );

      const nextBoundary = Math.min(
        expiresAt,
        idleDeadline - IDLE_WARNING_MS > current ? idleDeadline - IDLE_WARNING_MS : expiresAt,
        absoluteDeadline - ABSOLUTE_WARNING_MS > current ? absoluteDeadline - ABSOLUTE_WARNING_MS : expiresAt,
      );
      timer = window.setTimeout(evaluate, Math.max(1, nextBoundary - current + 1));
    };

    evaluate();
    return () => window.clearTimeout(timer);
  }, [active, absoluteDeadline, idleDeadline, now]);

  useEffect(() => {
    if (!active || absoluteDeadline === null) return;

    const recordActivity = () => {
      const current = now();
      if (current >= absoluteDeadline || current - lastActivityAt.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityAt.current = current;
      setIdleDeadline(current + IDLE_TIMEOUT_MS);
      setWarning((currentWarning) => (currentWarning?.kind === "idle" ? null : currentWarning));
    };

    for (const eventName of ACTIVITY_EVENTS) {
      activityTarget.addEventListener(eventName, recordActivity, { passive: true });
    }
    return () => {
      for (const eventName of ACTIVITY_EVENTS) {
        activityTarget.removeEventListener(eventName, recordActivity);
      }
    };
  }, [active, absoluteDeadline, activityTarget, now]);

  const continueSession = useCallback(() => {
    if (!active || absoluteDeadline === null) return;
    const current = now();
    if (current >= absoluteDeadline) return;
    setIdleDeadline(current + IDLE_TIMEOUT_MS);
    setWarning((currentWarning) => (currentWarning?.kind === "idle" ? null : currentWarning));
  }, [active, absoluteDeadline, now]);

  return { warning, continueSession };
}