import { useState } from "react";
import type { MitigationSuggestion } from "@/api/approvals";

const MAX_WORKER_CHIPS = 4;

function timingPhrase(timing: MitigationSuggestion["timing"]): string | null {
  if (!timing) return null;

  const parts = [
    timing.durationMinutes == null ? null : `for ${timing.durationMinutes} min`,
    timing.everyMinutes == null
      ? null
      : timing.everyMinutes === 60
        ? "every hour"
        : `every ${timing.everyMinutes} min`,
    timing.startByUtc == null
      ? null
      : `start by ${new Date(timing.startByUtc).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
  ].filter((part): part is string => part !== null);

  return parts.length === 0 ? null : parts.join(" · ");
}

export function MitigationRow({
  mitigation,
  workerNames,
}: Readonly<{
  mitigation: MitigationSuggestion;
  workerNames: ReadonlyMap<string, string>;
}>) {
  const [expanded, setExpanded] = useState(false);
  const appliesTo = mitigation.appliesTo ?? [];
  const shownWorkers = appliesTo.slice(0, MAX_WORKER_CHIPS);
  const hiddenWorkerCount = appliesTo.length - shownWorkers.length;
  const detailsAvailable = Boolean(
    mitigation.rationale || mitigation.ruleReference || mitigation.estimatedImpact,
  );
  const timing = timingPhrase(mitigation.timing);
  const origin = mitigation.origin ?? "ADVISORY";

  return (
    <article className="mitigation-row" aria-label={mitigation.action}>
      <div className="mitigation-row__summary">
        <div className="mitigation-row__title-row">
          <p className="mitigation-row__action">{mitigation.action}</p>
          <span
            className={`pill pill--attribute pill--attribute-${
              origin === "MANDATORY" ? "required" : "suggested"
            }`}
          >
            {origin}
          </span>
        </div>

        {timing && <p className="mitigation-row__timing">{timing}</p>}

        <div className="mitigation-row__chips" aria-label="Applies to">
          {appliesTo.length === 0 ? (
            <span className="pill pill--entity">Everyone on this shift</span>
          ) : (
            <>
              {shownWorkers.map((workerId) => (
                <span key={workerId} className="pill pill--entity">
                  {workerNames.get(workerId) ?? workerId}
                </span>
              ))}
              {hiddenWorkerCount > 0 && (
                <span className="pill pill--entity">+{hiddenWorkerCount} more</span>
              )}
            </>
          )}
        </div>

        {detailsAvailable && (
          <button
            type="button"
            className="mitigation-row__disclosure"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>
        )}
      </div>

      {expanded && (
        <dl className="mitigation-row__detail">
          {mitigation.rationale && <><dt>Rationale</dt><dd>{mitigation.rationale}</dd></>}
          {mitigation.ruleReference && <><dt>Rule reference</dt><dd>{mitigation.ruleReference}</dd></>}
          {mitigation.estimatedImpact && <><dt>Estimated impact</dt><dd>{mitigation.estimatedImpact}</dd></>}
        </dl>
      )}
    </article>
  );
}
