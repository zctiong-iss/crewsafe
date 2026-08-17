/**
 * The live / delayed / stale / simulated marker FR-12 requires on every weather reading.
 *
 * Not decoration. A worker deciding whether to keep going in the heat is entitled to know
 * whether the number they are looking at was measured four minutes ago or is a demo fixture,
 * and §12.2 requires every weather response to carry the freshness that drives it.
 *
 * ── WHY EVERY FRESHNESS IS AN ATTRIBUTE, NEVER A STATE ──────────────────────────────────
 * Freshness classifies the reading beside it; it is not a status asking anyone to decide
 * something. Filling it would put a loud pill directly next to the WBGT band — the one colour
 * on that surface that genuinely is a hazard signal — and the two would compete. Under
 * ADR-0017 §4 fill is reserved, and this is exactly the case it is reserved *from*: a STALE
 * badge matters, but the reading it qualifies matters more.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";

import Pill, { type PillTone } from "@/components/common/Pill";
import type { WeatherQualityStatus } from "@/types/domain";

const TONES: Record<WeatherQualityStatus, PillTone> = {
  LIVE: "success",
  DELAYED: "warning",
  STALE: "danger",
  // Its own tone, not reused from warning or danger: simulated data is not degraded data, and
  // conflating them would make a demo look like a fault.
  SIMULATED: "simulated",
};

const FreshnessBadge: FC<{ status: WeatherQualityStatus }> = ({ status }) => {
  const { t } = useTranslation();

  return <Pill role="attribute" tone={TONES[status]} label={t(`freshness.${status}`)} />;
};

export default FreshnessBadge;
