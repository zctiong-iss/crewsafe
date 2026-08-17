/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { fetchAccessibleSites } from "@/api/identity";
import { fetchSiteShifts, type Shift } from "@/api/shifts";
import { fetchShiftRecommendations, type Recommendation } from "@/api/approvals";
import { formatShiftRange } from "@/features/shifts/formatShiftRange";
import { RecommendationReviewCard } from "./RecommendationReviewCard";
import "./ApprovalsPage.css";

interface PendingItem {
  recommendation: Recommendation;
  siteId: string;
  siteName: string;
  shift: Shift;
}

type Load =
  | { status: "loading" }
  | { status: "loaded"; items: PendingItem[] }
  | { status: "error"; message: string; requestId: string | null };

async function loadPendingReviews(): Promise<PendingItem[]> {
  const sites = await fetchAccessibleSites();
  const perSite = await Promise.all(
    sites.map(async (site) => {
      const shifts = await fetchSiteShifts(site.id);
      const perShift = await Promise.all(
        shifts.map(async (shift) => {
          const recs = await fetchShiftRecommendations(site.id, shift.id);
          return recs
            .filter((recommendation) => recommendation.status === "PENDING_APPROVAL")
            .map((recommendation) => ({ recommendation, siteId: site.id, siteName: site.name, shift }));
        }),
      );
      return perShift.flat();
    }),
  );
  return perSite.flat();
}

export function ApprovalsPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let active = true;
    loadPendingReviews()
      .then((items) => active && setLoad({ status: "loaded", items }))
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
        ? { status: "loaded", items: current.items.filter((item) => item.recommendation.id !== recommendationId) }
        : current,
    );
  }

  return (
    <AppShell title="Approvals" subtitle="Plans Awaiting Review">
      {load.status === "loading" && <output className="approvals__loading">Loading Pending Plans…</output>}

      {load.status === "error" && <EmptyState headline="Could Not Load Plans" body={load.message} />}

      {load.status === "loaded" && load.items.length === 0 && (
        <EmptyState
          headline="You're all caught up!"
          body="No plans are waiting for your decision right now. When the agent drafts one for a shift, it appears here."
        />
      )}

      {load.status === "loaded" && load.items.length > 0 && (
        <section className="approvals__list" aria-label="Plans Awaiting Review">
          {load.items.map((item) => (
            <RecommendationReviewCard
              key={item.recommendation.id}
              recommendation={item.recommendation}
              siteId={item.siteId}
              siteName={item.siteName}
              shiftLabel={formatShiftRange(item.shift.startsAt, item.shift.endsAt)}
              onDecided={(updated) => removeItem(updated.id)}
            />
          ))}
        </section>
      )}
    </AppShell>
  );
}