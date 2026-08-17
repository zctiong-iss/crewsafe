/** @author Tang Chee Seng (with assistance from Claude) */
import type { RecommendationEvidence } from "@/api/approvals";

export function EvidenceSummary({ evidence }: Readonly<{ evidence: RecommendationEvidence | null }>) {
  if (!evidence) {
    return <p className="approvals__evidence approvals__evidence--empty">Weather conditions could not be not recorded at the point of drafting recommendations.</p>;
  }

  const wbgt = evidence.observedWbgt;
  return (
    <dl className="approvals__evidence" aria-label="Conditions at draft time">
      <div className="approvals__evidence-item">
        <dt>WBGT</dt>
         <dd>
          {wbgt === null ? "No reading" : `${wbgt.toFixed(1)}°C`}
          {evidence.currentBand ? ` · ${evidence.currentBand}` : ""}
        </dd>
      </div>
      <div className="approvals__evidence-item">
        <dt>Freshness</dt>
        <dd>{evidence.freshness ?? "Unknown"}</dd>
      </div>
      <div className="approvals__evidence-item">
        <dt>Lightning</dt>
        <dd>{evidence.lightningState ?? "Not ingested"}</dd>
      </div>
    </dl>
  );
}