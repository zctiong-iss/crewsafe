/**
 * @author Jemilin Beulah
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import {
  fetchLightningObservations,
  fetchLightningRisk,
  type LightningObservation,
  type LightningRisk,
} from "@/api/lightning";
import "./LightningHistory.css";

type Load =
  | { status: "loading" }
  | { status: "loaded"; risk: LightningRisk | null; observations: LightningObservation[] }
  | { status: "error"; message: string; requestId: string | null };

// Matches the two-minute ingestion cadence LightningController assumes clients poll at,
// halved so a reader watching the tab sees a tick land within one cycle, not two.
const REFRESH_MS = 60_000;

const timeFormat = new Intl.DateTimeFormat("en-SG", {
  day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore",
});

const STATE_LABEL: Record<LightningRisk["state"], string> = {
  CLEAR: "Clear",
  ADVISORY: "Advisory",
  STOP_WORK: "Stop work",
};

const FRESHNESS_LABEL: Record<LightningObservation["qualityStatus"], string> = {
  LIVE: "Live",
  DELAYED: "Delayed",
  STALE: "Stale",
  SIMULATED: "Simulated",
};

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
}

function StrikeDistance({ km }: { km: number | null }) {
  return km === null ? (
    <span className="lightning-history__no-strike">No strikes detected</span>
  ) : (
    <>{km.toFixed(2)} km</>
  );
}

function RiskCard({ risk }: { risk: LightningRisk | null }) {
  if (risk === null)
    return (
      <div className="lightning-history__risk-card lightning-history__risk-card--none">
        <span className="lightning-state lightning-state--none">No data</span>
        <p className="lightning-history__risk-detail">
          No lightning has been ingested for this site yet.
        </p>
      </div>
    );

  return (
    <div className={`lightning-history__risk-card lightning-history__risk-card--${risk.state.toLowerCase()}`}>
      <span className={`lightning-state lightning-state--${risk.state.toLowerCase()}`}>
        {STATE_LABEL[risk.state]}
      </span>
      <p className="lightning-history__risk-detail">
        {risk.nearestStrikeKm === null
          ? "No strikes detected on the latest reading. "
          : `Nearest strike ${risk.nearestStrikeKm.toFixed(2)} km away. `}
        Valid until {timeFormat.format(new Date(risk.validUntil))}.
      </p>
    </div>
  );
}

export function LightningHistory({ siteId, siteSwitcher }: { siteId: string; siteSwitcher?: ReactNode }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const refresh = useCallback(
    (background: boolean) => {
      Promise.all([fetchLightningRisk(siteId), fetchLightningObservations(siteId)])
        .then(([risk, observations]) => setLoad({ status: "loaded", risk, observations }))
        .catch((error: unknown) => {
          // A quiet background refresh failing keeps the last good reading on screen rather
          // than replacing it with an error state a reader would have to dismiss.
          if (background) return;
          const apiError = toApiError(error);
          setLoad({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
        });
    },
    [siteId],
  );

  useEffect(() => {
    setLoad({ status: "loading" });
    refresh(false);
    const id = setInterval(() => refresh(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [siteId, refresh]);

  return (
    <AppShell
      title="Lightning"
      subtitle="Nearest-strike readings ingested from NEA"
      siteSwitcher={siteSwitcher}
    >
      {load.status === "loading" && <p role="status">Loading lightning data…</p>}

      {load.status === "error" && (
        <EmptyState headline="Could not load lightning data" body={load.message} />
      )}

      {load.status === "loaded" && (
        <div className="lightning-history">
          <RiskCard risk={load.risk} />

          {load.observations.length === 0 ? (
            <EmptyState
              headline="No lightning readings yet"
              body="Readings will appear here automatically once NEA ingestion starts for this site."
            />
          ) : (
            <section className="lightning-history__table-card" aria-label="Lightning observation history">
              <h2 className="lightning-history__table-title">Recent readings</h2>
              <div className="lightning-history__table-scroll">
                <table className="lightning-history__table">
                  <thead>
                    <tr>
                      <th>Observed</th>
                      <th>Nearest strike</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {load.observations.map((observation) => (
                      <tr key={observation.id}>
                        <td>{timeFormat.format(new Date(observation.observedAt))}</td>
                        <td><StrikeDistance km={observation.nearestStrikeKm} /></td>
                        <td>
                          <span
                            className={
                              "lightning-badge lightning-badge--" +
                              observation.qualityStatus.toLowerCase()
                            }
                          >
                            {FRESHNESS_LABEL[observation.qualityStatus]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </AppShell>
  );
}
