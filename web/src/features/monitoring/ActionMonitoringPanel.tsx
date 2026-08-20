/** @author Tang Chee Seng (with assistance from Claude) */
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import {
  type ActionDispatch,
  type subscribeToActionStatus,
} from "@/api/actionStatusStream";
import { useActionStatusStream, type ConnectionState } from "./useActionStatusStream";
import { bucketDispatches } from "./actionMonitoringLogic";
import "./ActionMonitoringPanel.css";

const SHELL_TITLE = "Action Monitoring";
const SHELL_SUBTITLE = "Live dispatch acknowledgement & completion status";

// Connection badge copy + a non-colour glyph, so the state reads without relying on hue.
const CONNECTION_BADGE: Record<ConnectionState, { label: string; glyph: string }> = {
  connecting: { label: "Connecting", glyph: "…" },
  live: { label: "Live", glyph: "●" },
  degraded: { label: "Degraded", glyph: "▲" },
  closed: { label: "Closed", glyph: "■" },
};

// Each bucket carries its own label + glyph; colour is applied via the modifier class but is
// never the only signal — the heading text and glyph say the same thing.
const BUCKETS = [
  { key: "pending", label: "Pending", glyph: "○" },
  { key: "late", label: "Late", glyph: "▲" },
  { key: "acknowledged", label: "Acknowledged", glyph: "◑" },
  { key: "completed", label: "Completed", glyph: "●" },
] as const;

function shortWorker(workerId: string): string {
  // We hold only the id on this stream (no name lookup on the board); a short tail is enough
  // to tell two dispatches apart at a glance without dumping a full uuid on screen.
  return `Worker ${workerId.slice(0, 8)}`;
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DispatchItem({ dispatch }: Readonly<{ dispatch: ActionDispatch }>) {
  return (
    <li className="monitoring-dispatch">
      <div className="monitoring-dispatch__head">
        <span className="monitoring-dispatch__code">{dispatch.actionCode}</span>
        <span className="monitoring-dispatch__worker">{shortWorker(dispatch.workerId)}</span>
      </div>
      {dispatch.instruction && (
        <p className="monitoring-dispatch__instruction">{dispatch.instruction}</p>
      )}
      <p className="monitoring-dispatch__meta">
        Dispatched {clockTime(dispatch.dispatchedAt)}
        {dispatch.status === "LATE" && dispatch.lateAt && ` · Late since ${clockTime(dispatch.lateAt)}`}
        {dispatch.status === "COMPLETED" && dispatch.completedBy && ` · Completed by ${dispatch.completedBy.toLowerCase()}`}
      </p>
    </li>
  );
}

export function ActionMonitoringPanel({
  siteId,
  subscribe,
  siteSwitcher,
}: Readonly<{
  siteId: string;
  subscribe?: typeof subscribeToActionStatus;
  siteSwitcher?: ReactNode;
}>) {
  const { dispatches, counts, connectionState } = useActionStatusStream(siteId, subscribe);

  if (connectionState === "connecting" && counts === null)
    return (
      <AppShell title={SHELL_TITLE} subtitle={SHELL_SUBTITLE} siteSwitcher={siteSwitcher}>
        <output className="monitoring-panel__loading">Connecting to live dispatches...</output>
      </AppShell>
    );

  if (connectionState === "closed")
    return (
      <AppShell title={SHELL_TITLE} subtitle={SHELL_SUBTITLE} siteSwitcher={siteSwitcher}>
        <EmptyState
          headline="Live monitoring unavailable"
          body="Your session may have expired. Sign in again to resume the live feed."
        />
      </AppShell>
    );

  const buckets = bucketDispatches(dispatches);
  const badge = CONNECTION_BADGE[connectionState];
  const totalShown =
    buckets.pending.length + buckets.late.length + buckets.acknowledged.length + buckets.completed.length;

  const countFor: Record<string, number> = {
    pending: counts?.pending ?? 0,
    late: counts?.late ?? 0,
    acknowledged: counts?.acknowledged ?? 0,
    completed: counts?.completed ?? 0,
  };

  return (
    <AppShell title={SHELL_TITLE} subtitle={SHELL_SUBTITLE} siteSwitcher={siteSwitcher}>
      <section className="monitoring-panel" aria-label="Action dispatch monitoring">
        <div className="monitoring-panel__header">
          <output
            className={`monitoring-panel__badge monitoring-panel__badge--${connectionState}`}
          >
            <span aria-hidden="true">{badge.glyph}</span> {badge.label}
          </output>
          {counts?.asOf && (
            <span className="monitoring-panel__timestamp">Updated {clockTime(counts.asOf)}</span>
          )}
        </div>

        {connectionState === "degraded" && (
          <p className="monitoring-panel__degraded" role="alert">
            Live feed interrupted — showing the last complete update. Reconnecting...
          </p>
        )}

        <dl className="monitoring-panel__counts">
          {BUCKETS.map((bucket) => (
            <div
              key={bucket.key}
              className={`monitoring-panel__count monitoring-panel__count--${bucket.key}`}
            >
              <dt>
                <span aria-hidden="true">{bucket.glyph}</span> {bucket.label}
              </dt>
              <dd>{countFor[bucket.key]}</dd>
            </div>
          ))}
        </dl>

        {totalShown === 0 ? (
          <EmptyState
            headline="No active dispatches"
            body="When a shift is running and actions are dispatched to workers, they will appear here as they are acknowledged and completed."
          />
        ) : (
          <div className="monitoring-panel__buckets">
            {BUCKETS.map((bucket) => {
              const items = buckets[bucket.key];
              if (items.length === 0) return null;
              return (
                <section
                  key={bucket.key}
                  className={`monitoring-bucket monitoring-bucket--${bucket.key}`}
                  aria-label={`${bucket.label} dispatches`}
                >
                  <h2 className="monitoring-bucket__title">
                    <span aria-hidden="true">{bucket.glyph}</span> {bucket.label}
                    <span className="monitoring-bucket__tally">{items.length}</span>
                  </h2>
                  <ul className="monitoring-bucket__list">
                    {items.map((dispatch) => (
                      <DispatchItem key={dispatch.id} dispatch={dispatch} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
