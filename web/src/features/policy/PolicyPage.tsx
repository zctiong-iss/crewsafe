/**
 * @author Jemilin Beulah
 */
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { SitePicker } from "@/components/SitePicker";
import { useSelectedSite } from "@/site/useSelectedSite";
import { PolicyVersionList } from "./PolicyVersionList";

export function PolicyPage() {
  const { siteId } = useSelectedSite();

  if (!siteId)
    return (
      <AppShell title="Heat Policy">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask your site administrator."
        />
      </AppShell>
    );

  return <PolicyVersionList siteId={siteId} siteSwitcher={<SitePicker />} />;
}
