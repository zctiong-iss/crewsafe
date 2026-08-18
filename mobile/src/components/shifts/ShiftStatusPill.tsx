/**
 * A shift's status, as a pill.
 *
 * PLANNED / ACTIVE / CLOSED / CANCELLED. Server-controlled — a client cannot set it, and every shift is
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
  /*
   * CANCELLED outlines in danger rather than filling: it names a shift that did NOT happen,
   * which a supervisor must be able to tell apart from CLOSED at a glance. Outlined, not
   * filled, because it is not an active hazard and must not shout as loudly as ACTIVE.
   */
  CANCELLED: { role: "attribute", tone: "danger" },
};

/**
 * The fallback for a status this build does not know.
 *
 * Indexing PRESENTATION by an unrecognised status yields undefined, and the destructure below
 * then throws - which is exactly what a CANCELLED shift did before SCRUM-442 added it to the
 * union. Neutral rather than any particular state: a server that grows a fifth status should
 * degrade to an unstyled pill, never to a confident wrong one.
 */
const UNKNOWN = { role: "attribute", tone: "neutral" } as const;

const ShiftStatusPill: FC<{ status: ShiftStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const { role, tone } = PRESENTATION[status] ?? UNKNOWN;

  return <Pill role={role} tone={tone} label={t(`shifts.status.${status}`)} />;
};

export default ShiftStatusPill;
