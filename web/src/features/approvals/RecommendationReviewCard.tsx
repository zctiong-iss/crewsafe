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
  onDecided,
}: Readonly<{
  recommendation: Recommendation;
  siteId: string;
  siteName: string;
  shiftLabel: string;
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
    <article className="card approvals__card" aria-label={`Plan for ${shiftLabel}`}>
      <header className="approvals__card-head">
        <div>
          <h3 className="approvals__card-title">{shiftLabel}</h3>
          <p className="approvals__card-site">{siteName}</p>
        </div>
        <span className="pill">{recommendation.modelVersion ?? "No model recorded"}</span>
      </header>

      <EvidenceSummary evidence={recommendation.evidence} />

      <p className="approvals__rationale">{recommendation.rationale ?? "No rationale was recorded for this plan."}</p>

      <ul className="approvals__mitigations">
        {/* Keyed by content, not index. actionCode is unique per catalogue action. */}
        {recommendation.mitigations.map((m) => (
          <li key={m.actionCode ?? m.action} className="approvals__mitigation">
            <span className="pill">{m.origin ?? "ADVISORY"}</span> {m.action}
            {m.ruleReference ? <span className="approvals__rule"> ({m.ruleReference})</span> : null}
          </li>
        ))}
      </ul>

      {error && <p className="approvals__error" role="alert">{error}</p>}

      {panel === "none" && (
        <div className="approvals__actions">
          <button type="button" disabled={busy} onClick={() => submit({ decision: "APPROVED" })}>Approve</button>
          <button type="button" disabled={busy} onClick={() => setPanel("reject")}>Reject</button>
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
            <button type="button" disabled={busy || reason.trim() === ""}
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
            <button type="button" disabled={busy}
              onClick={() => submit({ decision: "EDITED", reason: reason || undefined, editedPlan })}>Save Edited Plan</button>
            <button type="button" disabled={busy} onClick={() => setPanel("none")}>Back</button>
          </div>
        </div>
      )}

      {busy && <output className="approvals__busy">Saving decision…</output>}
    </article>
  );
}