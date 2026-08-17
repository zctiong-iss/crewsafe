/**
 * @author Jemilin Beulah
 */
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { SiteCard } from "./SiteCard";
import { useCurrentUser } from "@/auth/useAuth";
import { fetchAccessibleSites, type Site } from "@/api/identity";
import { ApiError, messageFor } from "@/api/errors";
import "./HomePage.css";

type Load =
  | { status: "loading" }
  | { status: "loaded"; sites: Site[] }
  | { status: "error"; message: string; requestId: string | null };

/**
 * The live board, as far as it goes today.
 *
 * It renders what the backend can actually answer — which sites this user may reach — and
 * is explicit about the rest. No placeholder WBGT figures: a number on a safety console is
 * either real or dangerous, and a supervisor should never have to wonder which.
 *
 * Each site is already a card, so the readings, forecast and crew table from the design
 * drop into {@link SiteCard} when those endpoints exist, without this page changing shape.
 */
export function HomePage() {
  const user = useCurrentUser();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let active = true;

    fetchAccessibleSites()
      .then((sites) => active && setLoad({ status: "loaded", sites }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({
          status: "error",
          message: messageFor(apiError),
          requestId: apiError.requestId,
        });
      });

    // A fast unmount must not set state on a dead component, and must not leave a stale
    // response overwriting a newer one.
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell
      title="Live Board"
      subtitle={`Signed in as ${user.username}`}
    >
      {load.status === "loading" && (
        <output className="home__loading">
          Loading your sites
        </output>
      )}

      {load.status === "error" && (
        <EmptyState
          headline="Could not load your sites"
          body={
            <>
              {load.message}
              {load.requestId && (
                <>
                  {" "}
                  Reference <span className="code">{load.requestId}</span>.
                </>
              )}
            </>
          }
        />
      )}

      {load.status === "loaded" && load.sites.length === 0 && (
        <EmptyState
          headline="No sites assigned yet"
          body="You are signed in, but you have not been assigned to a site. Your site administrator assigns crew to sites — once that is done, your sites appear here."
        />
      )}

      {load.status === "loaded" && load.sites.length > 0 && (
        <section className="home__sites" aria-label="Your sites">
          {load.sites.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </section>
      )}
    </AppShell>
  );
}
