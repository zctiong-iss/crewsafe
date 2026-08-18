/** @author Tang Chee Seng (with assistance from Claude) */
import type { ShiftReadiness, ReadinessStatus } from "@/api/readiness";
import { formatShiftRange } from "@/features/shifts/formatShiftRange";

// Status -> label + tone, as a total Record over the union (S3358: NOT a nested ternary).
// A new ReadinessStatus value becomes a compile error here rather than an unlabelled pill.
const STATUS_COPY: Record<ReadinessStatus, { label: string; tone: string }> = {
  SUBMITTED: { label: "Ready", tone: "ok" },
  STALE: { label: "Stale", tone: "waiting" },
  MISSING: { label: "Missing", tone: "none" },
};

export function ShiftReadinessCard({ shift }: Readonly<{ shift: ShiftReadiness }>) {
  // A shift with no roster is a real state (created, not yet staffed) — say so, don't show 0/0/0
  // as if everyone were accounted for.
  const hasRoster = shift.workers.length > 0;
  const needsFollowUp = shift.missing + shift.stale;

  return (
    <article className="readiness-card card">
      <header className="readiness-card__header">
        <h2 className="readiness-card__when">{formatShiftRange(shift.startsAt, shift.endsAt)}</h2>
        {needsFollowUp > 0 && (
          <span className="pill readiness-card__flag">{needsFollowUp} to follow up</span>
        )}
      </header>

      {!hasRoster ? (
        <p className="readiness-card__empty">No workers assigned to this shift yet.</p>
      ) : (
        <>
          <p className="readiness-card__counts">
            <span className="readiness-count readiness-count--ok">{shift.submitted} ready</span>
            <span className="readiness-count readiness-count--waiting">{shift.stale} stale</span>
            <span className="readiness-count readiness-count--none">{shift.missing} missing</span>
          </p>

          <ul className="readiness-card__roster">
            {shift.workers.map((worker) => {
              // Resolve label+tone once, keeping the JSX flat and each conditional single-level.
              const copy = STATUS_COPY[worker.status];
              return (
                <li key={worker.workerId} className="readiness-row">
                  <span className="readiness-row__name">{worker.displayName}</span>
                  <span
                    className={`pill readiness-row__status readiness-row__status--${copy.tone}`}
                  >
                    {copy.label}
                  </span>
                  {/* fit-to-work only reads when a submission exists; explicit === false guards the MISSING null */}
                  {worker.status !== "MISSING" && worker.fitToWork === false && (
                    <span className="readiness-row__unfit">Reported unfit</span>
                  )}
                  {worker.flaggedSymptom && (
                    <span className="readiness-row__symptom">Symptom flagged — see wellbeing</span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}
