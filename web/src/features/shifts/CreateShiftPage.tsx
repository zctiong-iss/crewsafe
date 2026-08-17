/** @author Tang Chee Seng (with assistance from Claude) */

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/auth/useAuth";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import { CreateShiftForm } from "./CreateShiftForm";
import { fetchAccessibleSites, type Site } from "@/api/identity";

type SitesLoad =
  | { status: "loading" }
  | { status: "loaded"; sites: Site[] }
  | { status: "error"; message: string };

export function CreateShiftPage() {
  const user = useCurrentUser();
  const [sitesLoad, setSitesLoad] = useState<SitesLoad>({ status: "loading" });

  useEffect(() => {
      let active = true;
      fetchAccessibleSites()
        .then((list) => active && setSitesLoad({ status: "loaded", sites: list }))
        .catch((error: unknown) => {
          if (!active) return;
          const apiError =
            error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
          setSitesLoad({ status: "error", message: messageFor(apiError) });
        });
      return () => {
        active = false;
      };
    }, []);

  if (user.siteIds.length === 0) {
    return (
      <AppShell title="Create Shift">
        <EmptyState
          headline="No worksite assigned"
          body="You have not been assigned to a worksite yet. Approach the system administrator."
        />
      </AppShell>
    );
  }
if (sitesLoad.status === "loading") {
    return (
      <AppShell title="Create Shift">
        <output style={{ display: "block" }}>Loading worksites…</output>
      </AppShell>
    );
  }

  if (sitesLoad.status === "error") {
    return (
      <AppShell title="Create Shift">
        <EmptyState headline="Could not load worksites. Approach the system administrator." body={sitesLoad.message} />
      </AppShell>
    );
  }

  return <CreateShiftForm sites={sitesLoad.sites} />;
}