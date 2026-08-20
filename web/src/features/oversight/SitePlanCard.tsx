/** @author Tang Chee Seng (with assistance from Claude) */
import type { SitePlanSummary } from "@/api/oversight";
import "./SitePlanCard.css";

/**
 * One site on the oversight board.
 *
 * `awaitingDecision` is the actionable figure and reads largest — this screen exists so a
 * safety manager can scan for outstanding work across every site they oversee without
 * expanding each one. `totalPlans` is context, not a call to action.
 *
 * `siteName` is resolved by the page from the accessible-sites list, because
 * {@code /oversight/plan-summary} carries only a `siteId`. A raw UUID here is the exact defect
 * {@code OversightController}'s javadoc calls out for approver ids — a 36-char string a manager
 * cannot read or line-wrap — so the page passes the human name and this falls back to the id
 * only when a name genuinely cannot be resolved.
 *
 * Supervisors are rendered as who is accountable for the site's plans, never as authors —
 * see {@code OversightController.SiteSupervisor}'s javadoc: most plans are scheduler-drafted
 * with no human creator to name, so labelling a supervisor as "created by" would be a false
 * record on a screen that exists to make work traceable.
 */
export function SitePlanCard({
  summary,
  siteName,
}: Readonly<{ summary: SitePlanSummary; siteName: string }>) {
  return (
    <article className="site-plan-card card">
      <header className="site-plan-card__header">
        <span className="site-plan-card__site-name">{siteName}</span>
      </header>

      <div className="site-plan-card__body">
        <div className="site-plan-card__figures">
          <div className="site-plan-card__primary">
            <span className="site-plan-card__primary-value">{summary.awaitingDecision}</span>
            <span className="site-plan-card__primary-label">Awaiting decision</span>
          </div>
          <div className="site-plan-card__secondary">
            <span className="site-plan-card__secondary-value">{summary.totalPlans}</span>
            <span className="site-plan-card__secondary-label">Total plans</span>
          </div>
        </div>

        <div className="site-plan-card__supervisors">
          {summary.supervisors.length === 0 ? (
            <span className="site-plan-card__no-supervisor">No supervisor assigned</span>
          ) : (
            <ul className="site-plan-card__supervisor-list" aria-label="Accountable supervisors">
              {summary.supervisors.map((supervisor) => (
                <li key={supervisor.id} className="pill pill--entity site-plan-card__supervisor">
                  Accountable: {supervisor.displayName}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}
