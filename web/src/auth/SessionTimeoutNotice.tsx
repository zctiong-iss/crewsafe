/** @author Tang Chee Seng (with assistance from Claude and ChatGPT) */
import type { SessionWarning } from "./sessionPolicy";
import "./SessionTimeoutNotice.css";

export function SessionTimeoutNotice({
  warning,
  onContinue,
  onSignOut,
}: {
  warning: SessionWarning | null;
  onContinue: () => void;
  onSignOut: () => void;
}) {
  if (warning === null) return null;

  const absolute = warning.kind === "absolute";
  return (
    <section className="session-warning" role="alertdialog" aria-modal="true">
      <div className="session-warning__panel">
        <h2>{absolute ? "Your session is ending soon" : "Are you still working?"}</h2>
        <p>
          {absolute
            ? "For security, you will be logged out. Save your work and sign in again to continue."
            : "CrewSafe will sign you out after 30 minutes without activity."}
        </p>
        <div className="session-warning__actions">
          {/* Idle can be extended; absolute cannot — so Continue is offered only for idle. */}
          {!absolute && (
            <button type="button" onClick={onContinue}>Keep working</button>
          )}
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </section>
  );
}