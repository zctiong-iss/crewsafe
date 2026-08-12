/**
 * Time formatting for a workforce that reads three languages on one site.
 *
 * Everything from the backend is ISO 8601 in UTC (§12.2). Everything shown to a worker is
 * in Singapore time, because that is where they are standing — never the device's timezone,
 * which a travelling phone or a misconfigured emulator will get wrong, and never UTC, which
 * would put a shift on the wrong day.
 *
 * @author Justin Chua
 */
const SITE_TIME_ZONE = "Asia/Singapore";

/** `14:35` */
export function formatTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: SITE_TIME_ZONE,
    });
  } catch {
    // Hermes ships a trimmed ICU on some platforms; a missing locale must not blank a
    // timestamp on a safety screen.
    return new Date(iso).toISOString().slice(11, 16);
  }
}

/** `14:35, 2 Aug` — for anything that may not be today. */
export function formatDateTime(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      day: "numeric",
      month: "short",
      timeZone: SITE_TIME_ZONE,
    });
  } catch {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
  }
}

/**
 * Whole minutes remaining, floored, never negative.
 *
 * Floored deliberately: rounding up would show "1 min" for four seconds left, and on a
 * stop-work countdown the error should never be in the direction of "you have longer than
 * you do".
 */
export function minutesUntil(iso: string, now: number): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - now) / 60_000));
}

export function secondsUntil(iso: string, now: number): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
}

export function hasElapsed(iso: string, now: number): boolean {
  return now >= new Date(iso).getTime();
}

/**
 * `11 Aug 2026` — a calendar date with no time and no timezone conversion (SCRUM-120).
 *
 * Takes `YYYY-MM-DD`, not an instant. A policy version's effective date is a `LocalDate`: it is
 * the 11th everywhere, not an instant that lands on the 10th or 12th depending on where the phone
 * is. Every other formatter here deliberately converts to Singapore time; this one deliberately
 * does not convert at all, because there is nothing to convert.
 *
 * The parts are split by hand rather than parsed, since `new Date("2026-08-11")` is UTC midnight
 * and formatting that in a negative offset renders the previous day.
 */
export function formatDate(isoDate: string, locale: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;

  try {
    return new Date(year, month - 1, day).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    // Same reason as the others: a trimmed ICU must not blank a date on a safety screen.
    return isoDate;
  }
}
