import { useState } from "react";
import { AuthNotice } from "./AuthNotice";

/**
 * The sign-in screen, with somewhere for a failed redirect to go.
 *
 * signIn() calling out to Cognito can fail before the browser ever leaves this page — no
 * network, a firewall blocking the pool's domain, an ad-blocker. That failure has to land
 * somewhere: the naive `onClick={() => void signIn()}` discards the rejection entirely,
 * so a real connectivity problem looks identical to a page that simply does nothing when
 * clicked. A user cannot distinguish "broken" from "wait longer" from a screen that never
 * changes.
 *
 * A separate component, not a case in App's switch, because this is the one pre-app screen
 * that needs its own local state — the others are pure renders of {@link AuthState}.
 */
export function SignInScreen({ onSignIn }: { onSignIn: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSignIn = () => {
    setFailed(false);
    setPending(true);
    onSignIn().catch(() => {
      // On success the browser navigates away to Cognito entirely, so this component
      // unmounts and there is no "it worked" branch to write. Only the rejection reaches
      // here — a full-page redirect, once it starts, does not partially fail.
      setPending(false);
      setFailed(true);
    });
  };

  return (
    <AuthNotice
      tone={failed ? "warning" : "neutral"}
      title="Sign in to CrewSafe"
      body={
        failed
          ? "Could not reach the sign-in page. This is usually a network or firewall problem — check your connection and try again."
          : "You will be taken to your organisation's secure sign-in page, then brought back here."
      }
      busy={pending}
      action={{ label: "Sign in", onClick: handleSignIn }}
    />
  );
}
