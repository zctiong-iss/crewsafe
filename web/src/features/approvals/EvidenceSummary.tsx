/** @author Tang Chee Seng (with assistance from Claude) */
import type { RecommendationEvidence } from "@/api/approvals";

/*
 * Value colours mirror the mobile palette one-for-one — the same band/freshness/lightning state
 * reads the same colour on both platforms. Mappings are ported from mobile's
 * helpers/wbgtBandColor.ts, components/safety/FreshnessBadge.tsx and LightningBanner.tsx, and
 * resolve to the --signal-* tokens (tokens.css) rather than raw hex.
 *
 * An unmapped or null value is left uncoloured on purpose: an unknown reading must never borrow
 * the green that means "safe" (the same rule wbgtBandColor.ts states for mobile). The uppercase
 * dt label always sits above the value, so colour is reinforcement, never the only cue.
 */
const BAND_COLOR: Record<string, string> = {
  BELOW_31: "var(--signal-ok)",
  "31_TO_BELOW_32": "var(--signal-caution)",
  "32_TO_BELOW_33": "var(--signal-caution)",
  "33_AND_ABOVE": "var(--signal-alert)",
};
const FRESHNESS_COLOR: Record<string, string> = {
  LIVE: "var(--signal-ok)",
  DELAYED: "var(--signal-caution)",
  STALE: "var(--signal-alert)",
  SIMULATED: "var(--signal-simulated)",
};
const LIGHTNING_COLOR: Record<string, string> = {
  CLEAR: "var(--signal-ok)",
  ADVISORY: "var(--signal-caution)",
  STOP_WORK: "var(--signal-alert)",
};

// null/unknown → undefined, so the value inherits ordinary ink rather than a signal colour.
const signalColor = (map: Record<string, string>, value: string | null): string | undefined =>
  value ? map[value] : undefined;

export function EvidenceSummary({ evidence }: Readonly<{ evidence: RecommendationEvidence | null }>) {
  if (!evidence) {
    return <p className="approvals__evidence approvals__evidence--empty">Weather conditions could not be not recorded at the point of drafting recommendations.</p>;
  }

  const wbgt = evidence.observedWbgt;
  return (
    <dl className="approvals__evidence" aria-label="Conditions at draft time">
      <div className="approvals__evidence-item">
        <dt>WBGT</dt>
        {/* Coloured by the server-evaluated band; the band text itself is no longer shown. A
            missing reading stays uncoloured — no band to signal. */}
        <dd style={{ color: wbgt === null ? undefined : signalColor(BAND_COLOR, evidence.currentBand) }}>
          {wbgt === null ? "No reading" : `${wbgt.toFixed(1)}°C`}
        </dd>
      </div>
      <div className="approvals__evidence-item">
        <dt>Freshness</dt>
        <dd style={{ color: signalColor(FRESHNESS_COLOR, evidence.freshness) }}>
          {evidence.freshness ?? "Unknown"}
        </dd>
      </div>
      <div className="approvals__evidence-item">
        <dt>Lightning</dt>
        <dd style={{ color: signalColor(LIGHTNING_COLOR, evidence.lightningState) }}>
          {evidence.lightningState ?? "Not ingested"}
        </dd>
      </div>
    </dl>
  );
}
