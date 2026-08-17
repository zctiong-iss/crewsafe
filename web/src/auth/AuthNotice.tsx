/**
 * @author Jemilin Beulah
 */
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Wordmark";
import "./AuthNotice.css";

export interface AuthNoticeAction {
  label: string;
  onClick: () => void;
}

/**
 * The single layout behind every pre-app state: signing in, session ended, account not set
 * up, backend unreachable.
 *
 * One component rather than four pages because they differ only in words. Keeping them
 * together is what stops them drifting into four slightly different voices.
 */
export function AuthNotice({
  title,
  body,
  action,
  secondary,
  reference,
  busy = false,
  tone = "neutral",
}: Readonly<{
  title: string;
  body: ReactNode;
  action?: AuthNoticeAction;
  secondary?: AuthNoticeAction;
  /** A request id, shown so a user can quote it when asking for help. */
  reference?: string | null;
  busy?: boolean;
  tone?: "neutral" | "warning";
}>) {
  return (
    <main className="auth-notice">
      <div className={`auth-notice__panel auth-notice__panel--${tone}`}>
        <Wordmark />

        <div className="auth-notice__content">
          <h1 className="auth-notice__title">{title}</h1>
          <p className="auth-notice__body">{body}</p>
        </div>

        {busy && (
          <p className="auth-notice__busy" role="status">
            <span className="auth-notice__pulse" aria-hidden="true" />
            Working
          </p>
        )}

        {(action ?? secondary) && (
          <div className="auth-notice__actions">
            {action && (
              <button
                type="button"
                className="auth-notice__button"
                onClick={action.onClick}
                disabled={busy}
              >
                {action.label}
              </button>
            )}
            {secondary && (
              <button
                type="button"
                className="auth-notice__button auth-notice__button--quiet"
                onClick={secondary.onClick}
                disabled={busy}
              >
                {secondary.label}
              </button>
            )}
          </div>
        )}

        {reference && (
          <p className="auth-notice__reference">
            Reference <span className="code">{reference}</span>
          </p>
        )}
      </div>
    </main>
  );
}
