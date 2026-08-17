/**
 * A shift's status, as a pill.
 *
 * PLANNED / ACTIVE / CLOSED. Server-controlled — a client cannot set it, and every shift is
 * created PLANNED. So this only ever reports; there is no variant of it that is also a
 * control, deliberately.
 *
 * Since ADR-0017 the shape and fill rule live in `Pill`; this file owns only the mapping from
 * status to role and tone.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";

import Pill, { type PillRole, type PillTone } from "@/components/common/Pill";
import type { ShiftStatus } from "@/types/domain";

/**
 * ACTIVE is the only filled pill: people are on site right now, and that is the one row worth
 * spotting while scrolling a list. PLANNED and CLOSED classify a shift nobody needs to act on,
 * so they outline — three filled pills in a list is three things shouting equally.
 */
const PRESENTATION: Record<ShiftStatus, { role: PillRole; tone: PillTone }> = {
  PLANNED: { role: "attribute", tone: "neutral" },
  ACTIVE: { role: "state", tone: "success" },
  CLOSED: { role: "attribute", tone: "neutral" },
};

const ShiftStatusPill: FC<{ status: ShiftStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const { role, tone } = PRESENTATION[status];

  return <Pill role={role} tone={tone} label={t(`shifts.status.${status}`)} />;
};

export default ShiftStatusPill;
