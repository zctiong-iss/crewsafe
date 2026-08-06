/**
 * Fires once when a deadline passes, without re-rendering anything until it does.
 *
 * ── WHY NOT `useNow` ───────────────────────────────────────────────────────────────────
 * `useNow` is right for a card that is *showing* a countdown: the component has to re-render
 * every second anyway, so the clock is free. A card with no visible timer — an acknowledged
 * HYDRATE, dwelling for three minutes — has nothing to redraw, and ticking it once a second
 * for three minutes would be 180 renders to discover that nothing had changed. A single
 * timeout costs none.
 *
 * ── WHY A TIMEOUT ALONE IS NOT ENOUGH ──────────────────────────────────────────────────
 * A JS timer does not reliably fire while the app is backgrounded, and a long one can be
 * throttled or dropped entirely. A worker who acknowledges an action, pockets the phone and
 * looks again four minutes later would come back to a card that should have gone — and,
 * worse, to a timer still waiting to fire at a moment that has already passed.
 *
 * So the deadline is re-checked whenever the app returns to the foreground. The timeout is
 * the fast path; `AppState` is what makes it correct. Both funnel through the same guarded
 * `fire()`, so a race between them still produces exactly one call.
 *
 * The deadline itself is wall-clock and persisted (see `dispatchInboxSlice`), so nothing here
 * has to survive a process death — on relaunch the deadline is simply read again and, if it
 * has already passed, fires on mount.
 *
 * @author Justin Chua
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

export function useExpiryTimer(
  dismissAt: number | null,
  onExpire: () => void,
  enabled = true,
): void {
  /*
   * The callback is held in a ref so it is not a dependency of the effect below.
   *
   * Callers pass an inline arrow (`() => dispatch(dismissed(id))`), which is a new function
   * every render. As a dependency it would tear down and rebuild the timeout on every
   * render — and a three-minute timeout that restarts whenever the list re-renders never
   * fires at all.
   */
  const callback = useRef(onExpire);
  useEffect(() => {
    callback.current = onExpire;
  }, [onExpire]);

  const fired = useRef(false);

  useEffect(() => {
    if (!enabled || dismissAt === null) return;

    fired.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      callback.current();
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const remaining = dismissAt - Date.now();
      if (remaining <= 0) {
        fire();
        return;
      }
      timer = setTimeout(fire, remaining);
    };

    schedule();

    // Covers the backgrounded case: on return, the deadline may already have passed, and the
    // pending timeout cannot be trusted to have survived.
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") schedule();
    });

    return () => {
      if (timer) clearTimeout(timer);
      // Optional call for parity with `useReduceMotion`: a throw inside cleanup aborts
      // unmounting the whole subtree, and not every platform implements every event.
      subscription?.remove?.();
    };
  }, [dismissAt, enabled]);
}
