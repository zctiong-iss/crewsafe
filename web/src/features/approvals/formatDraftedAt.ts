/** @author Tang Chee Seng (with assistance from Claude) */

// When the agent drafted a plan, said two ways: a scannable relative age for the card face, and a
// clear DD MMM YYYY date-plus-time for the hover title and the <time> element. Both read the SAME
// Asia/Singapore zone as formatShiftRange, so the drafted date and the shift window never disagree.
const SITE_ZONE = "Asia/Singapore";

const date = new Intl.DateTimeFormat("en-GB", { timeZone: SITE_ZONE, day: "numeric", month: "short", year: "numeric" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: SITE_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative draft age for the card face, e.g. "just now", "5 minutes ago", "yesterday", "6 days ago".
 * numeric:"auto" is what yields "yesterday" rather than "1 day ago". A future timestamp (clock skew)
 * is floored to "just now" so a card never claims it was drafted in the future.
 */
export function draftedAgo(createdAt: string, now: number = Date.now()): string {
  const elapsed = now - new Date(createdAt).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");
  return relative.format(-Math.floor(elapsed / DAY), "day");
}

/** Full draft date + 24h time in site zone for the hover title / accessible label, e.g. "15 Aug 2026, 21:58". */
export function draftedAbsolute(createdAt: string): string {
  const at = new Date(createdAt);
  return `${date.format(at)}, ${clock.format(at)}`;
}
