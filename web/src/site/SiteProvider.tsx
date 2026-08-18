/**
 * @author Jemilin Beulah
 */
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchAccessibleSites, type Site } from "@/api/identity";
import { useCurrentUser } from "@/auth/useAuth";

const STORAGE_KEY = "crewsafe.selectedSiteId";

export interface SiteContextValue {
  /** Sites this user can access, with names. Empty until the fetch resolves. */
  sites: Site[];
  /** The site every site-scoped screen should read/write, or null if the user has none. */
  siteId: string | null;
  selectSite: (id: string) => void;
}

export const SiteContext = createContext<SiteContextValue | null>(null);

/**
 * The one place a "current site" is chosen, shared by every screen that shows a single
 * site at a time (Conditions, Policy) rather than aggregating across all of them (Live
 * Board, Shifts & Tasks — those already show every site and have no use for this).
 *
 * Deliberately client-side state only: never a URL param. ADR-0015 resolves `siteId` for
 * site-scoped requests from `/api/v1/me` rather than a URL segment specifically to keep an
 * attacker-controlled value out of the request path; a `sessionStorage`-backed selector
 * keeps that property while still letting a multi-site user switch what they're looking at.
 */
export function SiteProvider({ children }: Readonly<{ children: ReactNode }>) {
  const user = useCurrentUser();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored && user.siteIds.includes(stored) ? stored : (user.siteIds[0] ?? null);
  });

  useEffect(() => {
    let active = true;
    fetchAccessibleSites()
      .then((list) => {
        // Trust user.siteIds as the membership boundary, not whatever this endpoint
        // returns — the same rule selectSite enforces below. Keeps the picker's option
        // list exactly matched to "sites this user has", not "sites that exist".
        if (active) setSites(list.filter((site) => user.siteIds.includes(site.id)));
      })
      .catch(() => {
        // Names are cosmetic here — siteId (the thing requests actually depend on) is
        // already resolved from the auth context above, independent of this fetch.
      });
    return () => {
      active = false;
    };
  }, [user.siteIds]);

  const selectSite = useCallback(
    (id: string) => {
      if (!user.siteIds.includes(id)) return;
      setSiteId(id);
      sessionStorage.setItem(STORAGE_KEY, id);
    },
    [user.siteIds],
  );

  const value = useMemo(() => ({ sites, siteId, selectSite }), [sites, siteId, selectSite]);

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
