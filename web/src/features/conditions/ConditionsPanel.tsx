/** @author Jemilin Beulah, Tang Chee Seng */
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { type subscribeToConditions } from "@/api/conditionsStream";
import type { ConditionsRangeWarning } from "@/api/conditionsDecoder";
import {
  useConditionsStream,
  type ConditionsHistoryLoader,
} from "./useConditionsStream";
import { ConditionsTrendChart } from "./ConditionsTrendChart";
import { StopWorkBanner } from "./StopWorkBanner";
import "./ConditionsPanel.css";

// A lookup reads top-to-bottom; the nested ?: did not. Keys mirror the freshness union.
const FRESHNESS_LABEL: Record<string, string> = {
  LIVE: "Live",
  DELAYED: "Delayed",
  SIMULATED: "Simulated",
  STALE: "Stale",
};

function rangeWarningMessage(
  warning: ConditionsRangeWarning,
): string {
  if (warning.metric === "wbgt") {
    const reading =
      `Latest WBGT reading (${warning.value.toFixed(1)}°C)`;

    if (warning.value > warning.maximum) {
      return (
        `${reading} is above ${warning.maximum.toFixed(1)}°C. ` +
        `Take necessary heat-safety action and verify against official NEA data.`
      );
    }

    return (
      `${reading} is below ${warning.minimum.toFixed(1)}°C. ` +
      `Verify against official NEA data.`
    );
  }

  return (
    `Latest humidity reading (${warning.value}%) is outside the expected range. Sensor data may be unreliable.`
  );
}

export function ConditionsPanel({
  siteId,
  subscribe,
  loadHistory,
  siteSwitcher,
}: Readonly<{
  siteId: string;
  subscribe?: typeof subscribeToConditions;
  loadHistory?: ConditionsHistoryLoader;
  siteSwitcher?: ReactNode;
}>) {
  const {
    snapshot,
    connectionState,
    trend,
    stopWorkActive,
    rangeWarnings,
    historyState,
  } = useConditionsStream(siteId, subscribe, loadHistory);

  if (connectionState === "connecting" && snapshot === null)
    return (
      <AppShell title="Conditions" subtitle="Real-time site conditions & weather monitoring" siteSwitcher={siteSwitcher}>
        <output className="conditions-panel__loading">Connecting to live conditions...</output>
      </AppShell>
    );

  if (connectionState === "closed")
    return (
      <AppShell title="Conditions" subtitle="Real-time site conditions & weather monitoring" siteSwitcher={siteSwitcher}>
        <EmptyState
          headline="Live conditions unavailable"
          body="Your session may have expired. Sign in again to resume the live feed."
        />
      </AppShell>
    );

  const c = snapshot?.conditions ?? null;

  const badgeText = c === null ? null : (FRESHNESS_LABEL[c.freshness] ?? "Stale");

  return (
    <AppShell title="Conditions" subtitle="Real-time site conditions, WBGT heat stress & trend monitoring" siteSwitcher={siteSwitcher}>
      <section className="conditions-panel" aria-label="Site conditions">
        {stopWorkActive && snapshot?.lightning && (
          <StopWorkBanner lightning={snapshot.lightning} />
        )}

        {connectionState === "degraded" && (
          <p className="conditions-panel__degraded" role="alert">
            Live feed interrupted — showing last known reading. Reconnecting...
          </p>
        )}

        {rangeWarnings.length > 0 && (
          <p className="conditions-panel__degraded" role="alert">
            {rangeWarnings.map(rangeWarningMessage).join(" ")}
          </p>
        )}

        {c === null ? (
          <EmptyState
            headline="No weather reading for this site yet"
            body="Site weather station readings will populate here automatically once initial data is ingested."
          />
        ) : (
          <>
           <div className="conditions-panel__header">
              <output
                className={"conditions-panel__badge conditions-panel__badge--" + c.freshness.toLowerCase()}
              >
                {badgeText}
              </output>
              {c.observedAt && (
                <span className="conditions-panel__timestamp">
                  Reading observed at {new Date(c.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>

            <dl className="conditions-panel__values">
               <div className="conditions-panel__card conditions-panel__card--primary">
                <dt>WBGT Heat Index</dt>
                <dd className="conditions-panel__reading">{c.wbgt} °C</dd>
              </div>
              <div className="conditions-panel__card">
                <dt>Temperature</dt>
                <dd>{c.temperature} °C</dd>
              </div>
              <div className="conditions-panel__card">
                <dt>Humidity</dt>
                <dd>{c.humidity} %</dd>
              </div>
              <div className="conditions-panel__card">
                <dt>Wind Speed</dt>
                <dd>{c.windSpeed} kn</dd>
              </div>
              <div className="conditions-panel__card">
                <dt>Rainfall</dt>
                <dd>{c.rainfall} mm</dd>
              </div>
            </dl>

            <div className="conditions-panel__chart-card">
              <h2 className="conditions-panel__chart-title">
                WBGT Heat Stress Trend — Last 4 hours
              </h2>
              {historyState === "unavailable" && (
                <output className="conditions-panel__history-notice">
                  Historical readings unavailable — showing live updates only.
                </output>
              )}
              <ConditionsTrendChart points={trend} historyState={historyState} />
            </div>
          </>
        )}

        {snapshot?.activeShift && (
          <div className="conditions-panel__shift">
            <span className="conditions-panel__shift-indicator">●</span> Active shift in progress
          </div>
        )}
      </section>
    </AppShell>
  );
}
