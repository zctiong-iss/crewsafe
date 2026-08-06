/** @author Tang Chee Seng (with assistance from Claude) */

const SITE_ZONE = "Asia/Singapore";

const day = new Intl.DateTimeFormat("en-GB", { timeZone: SITE_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: SITE_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
// Day key in the SAME zone, so the same-day check and the display can never disagree across hosts.
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: SITE_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function formatShiftRange(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay = dayKey.format(start) === dayKey.format(end);   // compared IN site zone, not the host's
  return sameDay
    ? `${day.format(start)}, ${clock.format(start)}–${clock.format(end)}`
    : `${day.format(start)} ${clock.format(start)} – ${day.format(end)} ${clock.format(end)}`;
}