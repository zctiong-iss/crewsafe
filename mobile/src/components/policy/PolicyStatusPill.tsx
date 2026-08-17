/**
 * A policy version's standing, as a pill (SCRUM-120).
 *
 * Only the active one is filled. A version history is mostly retired versions, and three
 * filled pills down a screen is three things claiming equal weight when exactly one of them
 * governs anything.
 *
 * Since ADR-0017 the shape and fill rule live in `Pill`; this file owns only the mapping from
 * status to role, tone and label.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";

import Pill, { type PillRole, type PillTone } from "@/components/common/Pill";
import type { PolicyVersionStatus } from "@/types/domain";

const PRESENTATION: Record<
  PolicyVersionStatus,
  { role: PillRole; tone: PillTone; labelKey: string }
> = {
  // The one version that actually governs anything.
  ACTIVE: { role: "state", tone: "success", labelKey: "policy.statusActive" },
  // Written but not in force — a classification, not a call to action.
  DRAFT: { role: "attribute", tone: "warning", labelKey: "policy.statusDraft" },
  SUPERSEDED: { role: "attribute", tone: "neutral", labelKey: "policy.statusSuperseded" },
};

const PolicyStatusPill: FC<{ status: PolicyVersionStatus }> = ({ status }) => {
  const { t } = useTranslation();
  const { role, tone, labelKey } = PRESENTATION[status];

  return <Pill role={role} tone={tone} label={t(labelKey)} />;
};

export default PolicyStatusPill;
