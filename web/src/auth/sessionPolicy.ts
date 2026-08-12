/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
export const ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1_000;
export const IDLE_WARNING_MS = 2 * 60 * 1_000;
export const ABSOLUTE_WARNING_MS = 5 * 60 * 1_000;

const MAX_AUTH_TIME_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type SessionWarning = {
  kind: "idle" | "absolute";
  expiresAt: number;
};

/**
 * Cognito's auth_time is seconds since the Unix epoch and is not changed by silent renew.
 * That makes it the stable origin for an absolute session deadline.
 */
export function absoluteDeadlineFromAuthTime(authTime: unknown, now: number): number | null {
  if (typeof authTime !== "number" || !Number.isFinite(authTime) || authTime <= 0) {
    return null;
  }
  const authenticatedAt = authTime * 1_000;
  if (authenticatedAt > now + MAX_AUTH_TIME_CLOCK_SKEW_MS) return null;
  return authenticatedAt + ABSOLUTE_TIMEOUT_MS;
}