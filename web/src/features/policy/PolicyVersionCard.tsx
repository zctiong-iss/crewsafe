/**
 * @author Jemilin Beulah
 */
import { useState } from "react";
import type { PolicyVersion } from "@/api/policy";
import { THRESHOLD_GROUPS } from "./thresholds";

const STATUS_LABEL: Record<PolicyVersion["status"], string> = {
  DRAFT: "Draft",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
};

function StatusPill({ status }: { status: PolicyVersion["status"] }) {
  return (
    <span className={`pill pill--policy-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>
  );
}

function formatEffectiveDate(effectiveDate: string): string {
  // effectiveDate is a plain LocalDate ("2026-08-13") with no time component to convert —
  // parsing it as local midnight keeps the displayed day from shifting a day off in any zone.
  return new Date(`${effectiveDate}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PolicyVersionCard({ version, activeVersion, canWrite, isActivating, onActivate }: {
  /** Omits siteId so the company-wide default (siteId null) fits this prop too — this card never reads it. */
  version: Omit<PolicyVersion, "siteId">;
  /** The version currently ACTIVE for this site, if any — named in the activate confirmation. */
  activeVersion: PolicyVersion | null;
  canWrite: boolean;
  isActivating: boolean;
  onActivate: (versionId: string) => void;
}) {
  const [open, setOpen] = useState(version.status === "ACTIVE");
  const [confirming, setConfirming] = useState(false);

  const confirm = () => {
    setConfirming(false);
    onActivate(version.id);
  };

  return (
    <article className={`policy-card policy-card--${version.status.toLowerCase()} card`}>
      <div className="policy-card__summary">
        <header className="policy-card__header">
          <div>
            <p className="policy-card__source">{version.source}</p>
            <p className="policy-card__label">{version.versionLabel}</p>
            <p className="policy-card__date">Effective {formatEffectiveDate(version.effectiveDate)}</p>
          </div>
          <StatusPill status={version.status} />
        </header>

        <button
          type="button"
          className="policy-card__disclosure"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide thresholds" : "Show thresholds"}
        </button>
      </div>

      {open && (
        <div className="policy-card__detail">
          <div className="policy-card__thresholds-scroll">
            <table className="policy-card__thresholds">
              <thead>
                <tr>
                  <th>Acclimatisation</th>
                  <th>Light</th>
                  <th>Moderate</th>
                  <th>Heavy</th>
                </tr>
              </thead>
              <tbody>
                {THRESHOLD_GROUPS.map((group) => (
                  <tr key={group.level}>
                    <td className="policy-card__level">{group.level}</td>
                    <td>{version[group.light]}°C</td>
                    <td>{version[group.moderate]}°C</td>
                    <td>{version[group.heavy]}°C</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="policy-card__stop">
            Emergency stop <strong>{version.wbgtEmergencyStop}°C</strong> — no work above this,
            regardless of acclimatisation.
          </p>

          {version.notes && <p className="policy-card__notes">{version.notes}</p>}
        </div>
      )}

      {canWrite && version.status === "DRAFT" && !confirming && (
        <button
          type="button"
          className="policy-card__activate"
          onClick={() => setConfirming(true)}
          disabled={isActivating}
        >
          Activate this version
        </button>
      )}

      {confirming && (
        <div className="policy-card__confirm" role="alertdialog">
          <p>
            Activate <strong>{version.versionLabel}</strong>?
            {activeVersion
              ? <> This supersedes <strong>{activeVersion.versionLabel}</strong>, currently active.</>
              : " This becomes the site's first active policy version."}
          </p>
          <div className="policy-card__confirm-actions">
            <button type="button" onClick={() => setConfirming(false)} disabled={isActivating}>
              Cancel
            </button>
            <button type="button" className="policy-card__confirm-yes" onClick={confirm} disabled={isActivating}>
              {isActivating ? "Activating…" : "Confirm activation"}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
