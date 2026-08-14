/**
 * @author Jemilin Beulah
 */
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { SitePicker } from "@/components/SitePicker";
import { useSelectedSite } from "@/site/useSelectedSite";
import { LightningHistory } from "./LightningHistory";

export function LightningPage() {
  const { siteId } = useSelectedSite();

  if (!siteId)
    return (
      <AppShell title="Lightning">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask your site administrator."
        />
      </AppShell>
    );

  return <LightningHistory siteId={siteId} siteSwitcher={<SitePicker />} />;
}
