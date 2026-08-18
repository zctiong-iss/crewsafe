/**
 * @author Jemilin Beulah
 */
import { useState } from "react";
import { ApiError, messageFor } from "@/api/errors";
import { grantSiteMembership, revokeSiteMembership, type AdminSite, type AdminUser } from "@/api/admin";

export function SiteMembershipEditor({
  user,
  sites,
  onChanged,
}: Readonly<{
  user: AdminUser;
  sites: AdminSite[];
  onChanged: (siteIds: string[]) => void;
}>) {
  const [error, setError] = useState<string | null>(null);
  const [pendingSiteId, setPendingSiteId] = useState<string | null>(null);

  const toggle = (siteId: string, currentlyGranted: boolean) => {
    setError(null);
    setPendingSiteId(siteId);
    const request = currentlyGranted
      ? revokeSiteMembership(user.id, siteId)
      : grantSiteMembership(user.id, siteId);

    request
      .then(() => {
        const next = currentlyGranted
          ? user.siteIds.filter((id) => id !== siteId)
          : [...user.siteIds, siteId];
        onChanged(next);
      })
      .catch((err: unknown) => {
        const apiError = err instanceof ApiError ? err : new ApiError("server", "Unknown", null, null);
        setError(messageFor(apiError));
      })
      .finally(() => setPendingSiteId(null));
  };

  return (
    <div className="admin-list__memberships">
      {sites.map((site) => {
        const granted = user.siteIds.includes(site.id);
        return (
          <label key={site.id} className="admin-list__membership-option">
            <input
              type="checkbox"
              checked={granted}
              disabled={pendingSiteId === site.id}
              onChange={() => toggle(site.id, granted)}
            />
            {site.name}
          </label>
        );
      })}
      {error && <p className="admin-list__error" role="alert">{error}</p>}
    </div>
  );
}
