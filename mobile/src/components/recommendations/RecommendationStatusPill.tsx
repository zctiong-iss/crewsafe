/**
 * A recommendation's decision state, as a pill (SCRUM-119).
 *
 * ── WHAT THIS COMPONENT IS NOW ──────────────────────────────────────────────────────────
 * Since ADR-0017 it owns one thing only: mapping a status onto a **role** and a **tone**.
 * The shape, the fill rule, the border and the text treatment all live in `Pill`, which is
 * where the shape was lifted from in the first place. A supervisor moving between the shift,
 * policy and plan lists is reading one visual language because all four now render the same
 * component, not because four files were kept in sync by hand.
 *
 * ── WHY ONLY PENDING IS FILLED ──────────────────────────────────────────────────────────
 * PENDING_APPROVAL is the one status actively asking someone to decide something, so it is
 * the only STATE (filled) pill here. Everything else classifies a plan that has already been
 * settled, superseded or dispatched — those are ATTRIBUTE (outlined) pills, and a list of
 * decided plans recedes instead of shouting.
 *
 * ── EVERY STATUS IS NAMED, NONE FALLS THROUGH ───────────────────────────────────────────
 * The original chain ended in "otherwise, approved", so any unrecognised status rendered
 * green and said Approved. DRAFT is a legal backend value; SUPERSEDED (SCRUM-291) and
 * AUTO_DISPATCHED (SCRUM-440) were both added later. "A plan nobody approved shows as
 * approved" is not a failure worth leaving to a default branch, so the map below is total.
 *
 * @author Justin Chua
 */
import type { FC } from "react";
import { useTranslation } from "react-i18next";

import Pill, { type PillRole, type PillTone } from "@/components/common/Pill";
import type { ApprovalDecision, RecommendationStatus } from "@/types/domain";

interface RecommendationStatusPillProps {
  status: RecommendationStatus;
  /**
   * Distinguishes "approved as drafted" from "approved with edits" — the server folds both into
   * `APPROVED`, but they are different facts about what the supervisor did, and US-09 exists to
   * keep that distinction on the record.
   */
  decision?: ApprovalDecision | null;
}

/**
 * Status → how it should read. Total over `RecommendationStatus`, so a new backend value is a
 * compile error here rather than a silent green "Approved".
 *
 * `APPROVED` is absent on purpose: it is the one case that needs `decision` to choose its
 * label, and it is resolved below.
 */
const PRESENTATION: Record<
  Exclude<RecommendationStatus, "APPROVED">,
  { role: PillRole; tone: PillTone; labelKey: string }
> = {
  // The only filled pill: someone has to decide this now.
  PENDING_APPROVAL: { role: "state", tone: "warning", labelKey: "recommendations.pending" },
  REJECTED: { role: "attribute", tone: "danger", labelKey: "recommendations.decidedRejected" },
  // Not yet asking anything.
  DRAFT: { role: "attribute", tone: "neutral", labelKey: "recommendations.statusDraft" },
  // SCRUM-291: replaced by a newer auto-triggered draft before anyone decided. Not a decision
  // either way, so it recedes with the same muted treatment as DRAFT.
  SUPERSEDED: { role: "attribute", tone: "neutral", labelKey: "recommendations.statusSuperseded" },
  /*
   * SCRUM-440: a lightning-immediate or WBGT-max stop-work that skipped approval entirely and
   * has already reached workers. Also not a decision — but `danger`, not the muted grey the
   * other two non-actionable states use. A stop-work already in effect is not a plan quietly
   * receding into history; it is the most severe thing this screen can show, and the colour
   * should say so even though there is nothing left for the supervisor to tap.
   */
  AUTO_DISPATCHED: {
    role: "attribute",
    tone: "danger",
    labelKey: "recommendations.statusAutoDispatched",
  },
};

const RecommendationStatusPill: FC<RecommendationStatusPillProps> = ({ status, decision }) => {
  const { t } = useTranslation();

  if (status === "APPROVED") {
    return (
      <Pill
        role="attribute"
        tone="success"
        label={
          decision === "EDITED"
            ? t("recommendations.decidedEdited")
            : t("recommendations.decidedApproved")
        }
      />
    );
  }

  const { role, tone, labelKey } = PRESENTATION[status];
  return <Pill role={role} tone={tone} label={t(labelKey)} />;
};

export default RecommendationStatusPill;
