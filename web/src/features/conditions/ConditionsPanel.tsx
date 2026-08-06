/** @author Tang Chee Seng (with assistance from Claude) */
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { type subscribeToConditions } from "@/api/conditionsStream";
import { useConditionsStream } from "./useConditionsStream";
import { ConditionsTrendChart } from "./ConditionsTrendChart";
import { StopWorkBanner } from "./StopWorkBanner";

export function ConditionsPanel({
  siteId,
  subscribe,
}: {
  siteId: string;
  subscribe?: typeof subscribeToConditions;
}) {
  const { snapshot, connectionState, trend, stopWorkActive } = useConditionsStream(siteId, subscribe);

  if (connectionState === "connecting" && snapshot === null)
    return (
      <AppShell title="Conditions">
        <p role="status">Connecting to live conditions...</p>
      </AppShell>
    );

  if (connectionState === "closed")
    return (
      <AppShell title="Conditions">
        <EmptyState
          headline="Live conditions unavailable"
          body="Your session may have expired. Sign in again to resume the live feed."
        />
      </AppShell>
    );

  const c = snapshot?.conditions ?? null;

  const badgeText = c === null ? null
    : c.freshness === "LIVE" ? "Live"
    : c.freshness === "DELAYED" ? "Delayed"
    : "Stale";

  return (
    <AppShell title="Conditions">
      <section className="conditions-panel" aria-label="Site conditions">
        {stopWorkActive && snapshot?.lightning && (
          <StopWorkBanner lightning={snapshot.lightning} />
        )}

        {connectionState === "degraded" && (
          <p className="conditions-panel__degraded" role="alert">
            Live feed interrupted — showing last known reading. Reconnecting...
          </p>
        )}

        {c === null ? (
          <p role="status">No weather reading for this site yet.</p>
        ) : (
          <>
            <span
              className={"conditions-panel__badge conditions-panel__badge--" + c.freshness.toLowerCase()}
              role="status"
            >
              {badgeText}
            </span>

            <dl className="conditions-panel__values">
              <div><dt>WBGT</dt><dd>{c.wbgt} °C</dd></div>
              <div><dt>Temperature</dt><dd>{c.temperature} °C</dd></div>
              <div><dt>Humidity</dt><dd>{c.humidity} %</dd></div>
              <div><dt>Wind</dt><dd>{c.windSpeed} kn</dd></div>
              <div><dt>Rainfall</dt><dd>{c.rainfall} mm</dd></div>
            </dl>

            <ConditionsTrendChart points={trend} />
          </>
        )}

        {snapshot?.activeShift && (
          <p className="conditions-panel__shift">Active shift in progress</p>
        )}
      </section>
    </AppShell>
  );
}