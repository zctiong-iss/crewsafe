import type { Concern, ConcernSymptom } from "@/api/concernStream";
import type { ConcernConnectionState } from "./useConcernStream";

const CONNECTION_LABEL: Record<ConcernConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  degraded: "Degraded",
  closed: "Unavailable",
};

const SYMPTOM_LABEL: Record<ConcernSymptom, string> = {
  NONE: "None reported",
  DIZZINESS: "Dizziness",
  NAUSEA: "Nausea",
  HEADACHE: "Headache",
  FATIGUE: "Fatigue",
  MUSCLE_CRAMPS: "Muscle cramps",
  OTHER: "Other",
};

function shortWorker(workerId: string): string {
  return `Worker ${workerId.slice(0, 8)}`;
}

function raisedTime(raisedAt: string): string {
  return new Date(raisedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function UrgentConcernSection({
  concerns,
  connectionState,
  hasSnapshot,
}: Readonly<{
  concerns: readonly Concern[];
  connectionState: ConcernConnectionState;
  hasSnapshot: boolean;
}>) {
  if (concerns.length === 0 && hasSnapshot && connectionState === "live") return null;

  return (
    <section className="monitoring-concerns" aria-labelledby="urgent-concerns-title">
      <div className="monitoring-concerns__header">
        <h2 id="urgent-concerns-title" className="monitoring-concerns__title">
          <span aria-hidden="true">!</span> Urgent Worker Concerns
          <output
            className="monitoring-concerns__tally"
            aria-label={`${concerns.length} open concerns`}
            aria-live="assertive"
          >
            {concerns.length}
          </output>
        </h2>
        <span className={`monitoring-concerns__status monitoring-concerns__status--${connectionState}`}>
          {CONNECTION_LABEL[connectionState]}
        </span>
      </div>

      {connectionState === "degraded" && (
        <p className="monitoring-concerns__degraded" role="alert">
          Workers' feed interrupted — showing the last complete update. Reconnecting...
        </p>
      )}
      {connectionState === "closed" && (
        <p className="monitoring-concerns__degraded" role="alert">
          Workers' feed unavailable, but the action board remains available.
        </p>
      )}
      {!hasSnapshot && connectionState === "connecting" && concerns.length === 0 && (
        <output className="monitoring-concerns__empty">Connecting to workers' feed...</output>
      )}
      {hasSnapshot && connectionState === "live" && concerns.length === 0 && (
        <output className="monitoring-concerns__empty">No open concerns raised by workers.</output>
      )}
      {hasSnapshot && connectionState !== "live" && concerns.length === 0 && (
        <p className="monitoring-concerns__empty">Last complete update had no open worker concerns.</p>
      )}
      {concerns.length > 0 && (
        <ul className="monitoring-concerns__list" aria-live="polite">
          {concerns.map((concern) => (
            <ConcernItem key={concern.id} concern={concern} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConcernItem({ concern }: Readonly<{ concern: Concern }>) {
  return (
    <li className="monitoring-concern">
      <div className="monitoring-concern__head">
        <strong>{shortWorker(concern.workerId)}</strong>
        <span>{raisedTime(concern.raisedAt)}</span>
      </div>
      <p className="monitoring-concern__symptoms">
        {concern.symptoms.length > 0
          ? concern.symptoms.map((symptom) => SYMPTOM_LABEL[symptom]).join(", ")
          : "No symptoms selected"}
      </p>
      {concern.note && (
        <p className="monitoring-concern__note">
          Worker&apos;s own words (not translated): &ldquo;{concern.note}&rdquo;
        </p>
      )}
    </li>
  );
}
