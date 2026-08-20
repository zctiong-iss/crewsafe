/** @author Tang Chee Seng (with assistance from Claude) */
import { useState } from "react";
import {
  decideRecommendation,
  type MitigationSuggestion,
  type Recommendation,
  type RecommendationDecisionRequest,
} from "@/api/approvals";
import { ApiError, messageFor } from "@/api/errors";
import { EvidenceSummary } from "./EvidenceSummary";
import { MitigationEditor } from "./MitigationEditor";
import { AutoDispatchBanner } from "./AutoDispatchBanner";
import { MitigationRow } from "./MitigationRow";

type Panel = "none" | "reject" | "edit";

export function RecommendationReviewCard({
  recommendation,
  siteId,
  siteName,
  shiftLabel,
  workerNames,
  canDecide,
  onDecided,
}: Readonly<{
  recommendation: Recommendation;
  siteId: string;
  siteName: string;
  shiftLabel: string;
  workerNames: ReadonlyMap<string, string>;
  // Whether the signed-in role may act on this plan. A safety manager reads the queue but
  // cannot decide on it — same rule as the mobile detail screen, where the real gate is the
  // backend refusing the write and this is the matching UI so no button offers a 403.
  canDecide: boolean;
  onDecided: (updated: Recommendation) => void;
}>) {
  const [panel, setPanel] = useState<Panel>("none");
  const [reason, setReason] = useState("");
  const [editedPlan, setEditedPlan] = useState<MitigationSuggestion[]>(recommendation.mitigations);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rationaleExpanded, setRationaleExpanded] = useState(false);

  // A lightning-immediate stop-work skipped approval and was already dispatched — the spec says render
  // it distinctly, with no approve/reject affordance. So the card carries a danger banner + status pill
  // and drops the decision controls entirely (there is no decision left to make, for any role).
  const autoDispatched = recommendation.status === "AUTO_DISPATCHED";
  const uncategorisedMitigations = recommendation.mitigations.filter(
    (mitigation) => !mitigation.category?.trim(),
  );
  const mitigationGroups = recommendation.mitigations.reduce<Map<string, MitigationSuggestion[]>>(
    (groups, mitigation) => {
      const category = mitigation.category?.trim();
      if (!category) return groups;
      groups.set(category, [...(groups.get(category) ?? []), mitigation]);
      return groups;
    },
    new Map(),
  );

  // The one network path. Every button builds a body and calls this — token, error mapping and
  // the "lift decided recommendation up" all live here once.
  async function submit(body: RecommendationDecisionRequest) {
    setBusy(true);
    setError(null);
    try {
      const updated = await decideRecommendation(siteId, recommendation.shiftId, recommendation.id, body);
      onDecided(updated);
    } catch (error: unknown) {
      const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
      setError(messageFor(apiError));
      setBusy(false); // Stay on the card so the supervisor can retry.
    }
  }

  return (
    // One list item = the card (the view) plus its decision controls. The controls sit BELOW and
    // OUTSIDE the card; the wrapper's own gap spaces the card from its controls, and .approvals__list
    // spaces one item from the next — the same margin throughout (see ApprovalsPage.css).
    <div className="approvals__item">
      <article className="card approvals__card" aria-label={`Plan for ${shiftLabel}`}>
        {autoDispatched && <AutoDispatchBanner />}

        <header className="approvals__card-head">
          <div>
            <h3 className="approvals__card-title">{shiftLabel}</h3>
            <p className="approvals__card-site">{siteName}</p>
          </div>
          <div className="approvals__card-pills">
            {autoDispatched && (
              <span className="pill approvals__status--auto-dispatched">Stop-work dispatched</span>
            )}
            <span className="pill pill--attribute pill--attribute-muted">{recommendation.modelVersion ?? "No model recorded"}</span>
          </div>
        </header>

        <EvidenceSummary evidence={recommendation.evidence} />

        {/* The "why this was drafted" narrative, in its own panel — equal padding inside and
            equal margin all round, so the reasoning reads as one centred, self-contained block. */}
        <div className="approvals__rationale">
          <p className={`approvals__rationale-text${rationaleExpanded ? "" : " approvals__rationale-text--clamped"}`}>
            {recommendation.rationale ?? "No rationale was recorded for this plan."}
          </p>
          {recommendation.rationale && (
            <button
              type="button"
              className="approvals__disclosure"
              onClick={() => setRationaleExpanded((expanded) => !expanded)}
            >
              {rationaleExpanded ? "Read less" : "Read more"}
            </button>
          )}
        </div>

        <div className="approvals__mitigation-groups">
          {uncategorisedMitigations.length > 0 && (
            <div className="approvals__mitigations">
              {uncategorisedMitigations.map((mitigation) => (
                <MitigationRow
                  key={mitigation.actionCode ?? mitigation.action}
                  mitigation={mitigation}
                  workerNames={workerNames}
                />
              ))}
            </div>
          )}
          {[...mitigationGroups].map(([category, mitigations], index) => {
            const categoryId = `mitigation-category-${recommendation.id}-${index}`;
            return (
            <section key={category} className="approvals__mitigation-group" aria-labelledby={categoryId}>
              <h4 id={categoryId} className="approvals__mitigation-category">{category}</h4>
              <div className="approvals__mitigations">
                {mitigations.map((mitigation) => (
                  <MitigationRow
                    key={mitigation.actionCode ?? mitigation.action}
                    mitigation={mitigation}
                    workerNames={workerNames}
                  />
                ))}
              </div>
            </section>
            );
          })}
        </div>
      </article>

      {/* Decision controls: below the card, outside its border, aligned to its left edge. The
          Reject / Edit forms open here too, so a control and the form it opens stay together.

          A safety manager sees the plan but not the controls — a plain read-only notice in their
          place, said once rather than shown as three buttons that would each answer 403.

          An auto-dispatched stop-work shows no controls at all (for any role): the banner above has
          already said there is nothing to decide. */}
      {!autoDispatched &&
        (!canDecide ? (
        <p className="approvals__readonly">You can read this plan but not decide on it.</p>
      ) : (
      <div className="approvals__controls">
        {error && <p className="approvals__error" role="alert">{error}</p>}

        {panel === "none" && (
          <div className="approvals__actions">
            <button type="button" className="approvals__btn--primary" disabled={busy}
              onClick={() => submit({ decision: "APPROVED" })}>Approve</button>
            <button type="button" className="approvals__btn--danger" disabled={busy}
              onClick={() => setPanel("reject")}>Reject</button>
            <button type="button" disabled={busy}
              onClick={() => { setEditedPlan(recommendation.mitigations); setPanel("edit"); }}>Edit Plan</button>
          </div>
        )}

        {panel === "reject" && (
          <div className="approvals__panel">
            <label className="approvals__label">
              <span>Reason (Required)</span>
              <textarea
                  aria-required="true"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="approvals__actions">
              <button type="button" className="approvals__btn--danger" disabled={busy || reason.trim() === ""}
                onClick={() => {
                  const trimmedReason = reason.trim();
                  if (!trimmedReason) return;

                submit({
                  decision: "REJECTED",
                  reason: trimmedReason
                  });
                }}>
                  Confirm Rejection</button>
              <button type="button" disabled={busy} onClick={() => setPanel("none")}>Back</button>
            </div>
          </div>
        )}

        {panel === "edit" && (
          <div className="approvals__panel">
            <MitigationEditor initial={recommendation.mitigations} onChange={setEditedPlan} />
            <label className="approvals__label">
              <span>Reason for Editing (Optional)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="approvals__actions">
              <button type="button" className="approvals__btn--primary" disabled={busy}
                onClick={() => submit({ decision: "EDITED", reason: reason || undefined, editedPlan })}>Save Edited Plan</button>
              <button type="button" disabled={busy} onClick={() => setPanel("none")}>Back</button>
            </div>
          </div>
        )}

        {busy && <output className="approvals__busy">Saving decision…</output>}
      </div>
      ))}
    </div>
  );
}
