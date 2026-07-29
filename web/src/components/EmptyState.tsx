/**
 * @author Jemilin Beulah
 */
import type { ReactNode } from "react";
import "./EmptyState.css";

/**
 * An empty screen is an invitation to act, not an apology.
 *
 * Each use says what is not here, why, and what to do about it — never just "No data".
 * A supervisor who opens a blank board mid-shift needs to know within a second whether
 * something is broken or simply not set up yet.
 */
export function EmptyState({
  headline,
  body,
  action,
}: {
  headline: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2 className="empty-state__headline">{headline}</h2>
      <p className="empty-state__body">{body}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
