/**
 * Turns a reading's freshness into a warning the worker can act on.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────
 * §7.1's rule matrix has an entry that is easy to miss because it is not about a
 * temperature at all:
 *
 *   "Data stale beyond configured threshold → Do not treat old data as current; show
 *    warning; use site reading/manual confirmation or conservative site procedure"
 *
 * A coloured badge reading "Stale" does not discharge that. It labels the data without
 * telling anyone what to do about it, and a worker who has never been told what "stale"
 * means will read the number anyway — a plausible 31.2°C from forty minutes ago looks
 * exactly like a current one. The badge is the label; this is the instruction.
 *
 * The tone escalates with the consequence rather than being uniform:
 *
 *   STALE      danger   — the reading must not be acted on at all
 *   DELAYED    warning  — usable, but conditions may have moved
 *   SIMULATED  info     — not real, but not a fault either; nothing has degraded
 *   LIVE       nothing  — silence is the correct output; a "data is fine" banner
 *                         every time would train people to ignore the space it occupies
 *
 * ── WHERE THIS STILL RENDERS, AND WHERE IT NO LONGER DOES ───────────────────────────────
 * Two callers, and they deliberately no longer agree.
 *
 * `WeatherScreen` now renders this for STALE ONLY. DELAYED and SIMULATED moved behind a tap
 * on the weather card itself (`WeatherStatusButton` / `WeatherStatusModal`), because a
 * permanent banner on the screen a worker checks most often is read as furniture by the tenth
 * viewing. STALE did not move with them: §7.1 requires stale data to "show warning", and a
 * warning only visible after tapping an icon nobody had reason to tap has not been shown.
 *
 * `MyShiftScreen` still renders this for every non-LIVE state, unchanged. Two reasons, and
 * the second is the real one. There is no weather card on that screen to embed an icon into,
 * so the change does not port cleanly — and more importantly, a worker who never opens the
 * Weather tab may see no other weather warning all shift. Collapsing it there would take a
 * standing warning off the screen they actually use to save space on a screen they do not.
 *
 * The divergence is the decision, not an oversight. Anyone unifying the two should decide
 * which of those two readings they are overruling.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import MessageBanner, { type BannerTone } from "../feedback/MessageBanner";
import type { WeatherQualityStatus } from "@/types/domain";

const NOTICES: Partial<Record<WeatherQualityStatus, { tone: BannerTone; key: string }>> = {
  STALE: { tone: "danger", key: "freshness.staleWarning" },
  DELAYED: { tone: "warning", key: "freshness.delayedWarning" },
  SIMULATED: { tone: "info", key: "freshness.simulatedNotice" },
};

/**
 * Whether this state has earned a banner that is always on screen.
 *
 * ── A NAMED RULE, NOT AN INLINE COMPARISON ──────────────────────────────────────────────
 * `WeatherScreen` needs to know this, and writing `status === "STALE"` at the call site would
 * leave the reasoning — §7.1's "show warning" requirement — sitting in a comment on a screen,
 * one refactor away from being read as an arbitrary special case and tidied into consistency
 * with the others.
 *
 * STALE is the only true one. It is the state where the reading must not be acted on at all,
 * and a warning only visible after tapping an icon nobody had reason to tap has not been
 * shown. DELAYED and SIMULATED are footnotes on usable data and live behind the tap.
 */
export function showsStandingBanner(status: WeatherQualityStatus): boolean {
  return status === "STALE";
}

const FreshnessNotice: FC<{ status: WeatherQualityStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const notice = NOTICES[status];

  if (!notice) return null;

  return <MessageBanner message={t(notice.key)} tone={notice.tone} />;
};

export default FreshnessNotice;
