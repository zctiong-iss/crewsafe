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

const FreshnessNotice: FC<{ status: WeatherQualityStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const notice = NOTICES[status];

  if (!notice) return null;

  return <MessageBanner message={t(notice.key)} tone={notice.tone} />;
};

export default FreshnessNotice;
