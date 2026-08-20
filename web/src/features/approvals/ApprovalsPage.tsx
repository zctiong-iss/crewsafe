/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { useCurrentUser } from "@/auth/useAuth";
import { ApiError, messageFor } from "@/api/errors";
import { fetchAccessibleSites } from "@/api/identity";
import { fetchSiteShifts, type Shift } from "@/api/shifts";
import { fetchShiftRecommendations, type Recommendation } from "@/api/approvals";
import { formatShiftRange } from "@/features/shifts/formatShiftRange";
import { RecommendationReviewCard } from "./RecommendationReviewCard";
import { SupersededList, type SupersededItem } from "./SupersededList";
import "./ApprovalsPage.css";

interface PendingItem {
  recommendation: Recommendation;
  siteId: string;
  siteName: string;
  shift: Shift;
}

interface ReviewData {
  queue: PendingItem[];
  superseded: SupersededItem[];
}

type Load =
  | { status: "loading" }
  | { status: "loaded"; queue: PendingItem[]; superseded: SupersededItem[] }
  | { status: "error"; message: string; requestId: string | null };

// Queue sort weight: an auto-dispatched stop-work floats above plans still awaiting a decision.
const queueRank = (status: Recommendation["status"]): number =>
  status === "AUTO_DISPATCHED" ? 0 : 1;

async function loadReviewData(): Promise<ReviewData> {
  const sites = await fetchAccessibleSites();
  const perSite = await Promise.all(
    sites.map(async (site) => {
      const shifts = await fetchSiteShifts(site.id);
      const perShift = await Promise.all(
        shifts.map(async (shift) => {
          const recs = await fetchShiftRecommendations(site.id, shift.id);
          return recs.map((recommendation) => ({
            recommendation,
            siteId: site.id,
            siteName: site.name,
            shift,
          }));
        }),
      );
      return perShift.flat();
    }),
  );
  const all = perSite.flat();

  // The queue holds only what a supervisor must see now: a plan awaiting a decision, and an
  // auto-dispatched stop-work (no decision left to make, but the most urgent item on the screen).
  // APPROVED / REJECTED / DRAFT are dropped — nothing to act on.
  const queue = all
    .filter(
      (item) =>
        item.recommendation.status === "PENDING_APPROVAL" ||
        item.recommendation.status === "AUTO_DISPATCHED",
    )
    .sort((a, b) => {
      const byStatus =
        queueRank(a.recommendation.status) - queueRank(b.recommendation.status);
      // Within a status, oldest-drafted first so the queue reads in the order plans arrived.
      return byStatus !== 0
        ? byStatus
        : a.recommendation.createdAt.localeCompare(b.recommendation.createdAt);
    });

  // A superseded plan has nothing to decide, so it leaves the queue — but it recedes into a muted
  // note rather than vanishing, so a supervisor sees that conditions changed and replaced it.
  const superseded: SupersededItem[] = all
    .filter((item) => item.recommendation.status === "SUPERSEDED")
    .map((item) => ({
      id: item.recommendation.id,
      shiftLabel: formatShiftRange(item.shift.startsAt, item.shift.endsAt),
      siteName: item.siteName,
    }));

  return { queue, superseded };
}

export function ApprovalsPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  // Who may act on a plan, computed once for the whole queue. Same predicate as the mobile
  // detail screen (RecommendationDetailScreen: SUPERVISOR || ADMIN) so the two clients agree on
  // one rule — a safety manager reads the queue read-only. ADMIN never reaches this route on the
  // web (see routeAccess), but the predicate is kept identical to mobile's on purpose.
  const { role } = useCurrentUser();
  const canDecide = role === "SUPERVISOR" || role === "ADMIN";

  useEffect(() => {
    let active = true;
    loadReviewData()
      .then((data) => active && setLoad({ status: "loaded", ...data }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
    return () => { active = false; };
  }, []);

  // Drop a decided recommendation locally
  function removeItem(recommendationId: string) {
    setLoad((current) =>
      current.status === "loaded"
        ? {
            ...current,
            queue: current.queue.filter((item) => item.recommendation.id !== recommendationId),
          }
        : current,
    );
  }

  return (
    <AppShell title="Approvals" subtitle="Plans Awaiting Review">
      {load.status === "loading" && <output className="approvals__loading">Loading Pending Plans…</output>}

      {load.status === "error" && <EmptyState headline="Could Not Load Plans" body={load.message} />}

      {load.status === "loaded" && load.queue.length === 0 && (
        <EmptyState
          headline="You're all caught up!"
          body="No plans are waiting for your decision right now. When the agent drafts one for a shift, it appears here."
        />
      )}

      {load.status === "loaded" && load.queue.length > 0 && (
        <section className="approvals__list" aria-label="Plans Awaiting Review">
          {load.queue.map((item) => (
            <RecommendationReviewCard
              key={item.recommendation.id}
              recommendation={item.recommendation}
              siteId={item.siteId}
              siteName={item.siteName}
              shiftLabel={formatShiftRange(item.shift.startsAt, item.shift.endsAt)}
              canDecide={canDecide}
              onDecided={(updated) => removeItem(updated.id)}
            />
          ))}
        </section>
      )}

      {load.status === "loaded" && <SupersededList items={load.superseded} />}
    </AppShell>
  );
}
