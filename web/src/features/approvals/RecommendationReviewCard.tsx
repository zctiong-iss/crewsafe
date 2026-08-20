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

type Panel = "none" | "reject" | "edit";

export function RecommendationReviewCard({
  recommendation,
  siteId,
  siteName,
  shiftLabel,
  canDecide,
  onDecided,
}: Readonly<{
  recommendation: Recommendation;
  siteId: string;
  siteName: string;
  shiftLabel: string;
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
        <header className="approvals__card-head">
          <div>
            <h3 className="approvals__card-title">{shiftLabel}</h3>
            <p className="approvals__card-site">{siteName}</p>
          </div>
          <span className="pill">{recommendation.modelVersion ?? "No model recorded"}</span>
        </header>

        <EvidenceSummary evidence={recommendation.evidence} />

        {/* The "why this was drafted" narrative, in its own panel — equal padding inside and
            equal margin all round, so the reasoning reads as one centred, self-contained block. */}
        <div className="approvals__rationale">
          <p className="approvals__rationale-text">
            {recommendation.rationale ?? "No rationale was recorded for this plan."}
          </p>
        </div>

        <ul className="approvals__mitigations">
          {/* Keyed by content, not index. actionCode is unique per catalogue action. */}
          {recommendation.mitigations.map((m) => (
            <li key={m.actionCode ?? m.action} className="approvals__mitigation">
              {/* Origin as an outlined attribute pill: MANDATORY reads danger-red, ADVISORY
                  (the null-origin default too) reads caution-amber. */}
              <span
                className={`pill pill--attribute ${
                  m.origin === "MANDATORY" ? "approvals__origin--mandatory" : "approvals__origin--advisory"
                }`}
              >
                {m.origin ?? "ADVISORY"}
              </span>
              {/* The action itself as a neutral entity chip — content, not a severity signal. */}
              <span className="pill pill--entity approvals__action">{m.action}</span>
            </li>
          ))}
        </ul>
      </article>

      {/* Decision controls: below the card, outside its border, aligned to its left edge. The
          Reject / Edit forms open here too, so a control and the form it opens stay together.

          A safety manager sees the plan but not the controls — a plain read-only notice in their
          place, said once rather than shown as three buttons that would each answer 403. */}
      {!canDecide ? (
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
      )}
    </div>
  );
}
