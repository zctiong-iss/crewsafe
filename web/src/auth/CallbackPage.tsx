/**
 * @author Jemilin Beulah
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthNotice } from "./AuthNotice";
import { useAuth } from "./useAuth";

/**
 * Where Cognito sends the browser back after login.
 *
 * The only job here is to hand the authorization code to the auth provider and get out of
 * the way. It renders a message rather than nothing, because on a slow connection this
 * screen is visible for a second or two and a blank page reads as a broken app.
 */
export function CallbackPage() {
  const navigate = useNavigate();
  const { completeSignIn } = useAuth();
  const [failed, setFailed] = useState(false);

  // React mounts effects twice in StrictMode. An authorization code is single-use, so a
  // second exchange always fails — this guard is what stops a successful login from
  // reporting an error to the user.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    completeSignIn()
      .then(() => {
        // replace, not push: the URL still holds the authorization code, and it must not be
        // reachable with the browser's back button.
        navigate("/", { replace: true });
      })
      .catch(() => setFailed(true));
  }, [completeSignIn, navigate]);

  if (failed) {
    return (
      <AuthNotice
        tone="warning"
        title="Sign-in did not complete"
        body="The sign-in link has expired or was already used. Start again from the sign-in page."
        action={{ label: "Back to sign in", onClick: () => navigate("/", { replace: true }) }}
      />
    );
  }

  return <AuthNotice title="Signing you in" body="Finishing sign-in with Cognito." busy />;
}
