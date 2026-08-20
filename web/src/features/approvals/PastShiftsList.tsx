/** @author Tang Chee Seng (with assistance from Claude) */
import type { Recommendation } from "@/api/approvals";
import { formatShiftRange } from "@/features/shifts/formatShiftRange";
import { RecommendationReviewCard } from "./RecommendationReviewCard";
import type { PendingItem } from "./ApprovalsPage";

// Plans whose shift has already ended: still actionable, but no longer current work. They recede into
// a collapsed disclosure below the live queue — enough to say "there's a backlog here" without letting
// stale plans crowd out the plans that still matter now. Unlike SupersededList (a muted label list with
// nothing to decide), this holds the FULL review cards so a supervisor can expand and clear them.
export function PastShiftsList({
  items,
  canDecide,
  onDecided,
}: Readonly<{
  items: PendingItem[];
  canDecide: boolean;
  onDecided: (updated: Recommendation) => void;
}>) {
  if (items.length === 0) return null;

  return (
    <details className="approvals__past">
      <summary className="approvals__past-summary">Past shifts ({items.length})</summary>
      <p className="approvals__past-note">
        These plans are for shifts that have already ended. Review them if you still need to clear the backlog.
      </p>
      <section className="approvals__list" aria-label="Past shifts">
        {items.map((item) => (
          <RecommendationReviewCard
            key={item.recommendation.id}
            recommendation={item.recommendation}
            siteId={item.siteId}
            siteName={item.siteName}
            shiftLabel={formatShiftRange(item.shift.startsAt, item.shift.endsAt)}
            workerNames={item.workerNames}
            canDecide={canDecide}
            onDecided={onDecided}
          />
        ))}
      </section>
    </details>
  );
}
