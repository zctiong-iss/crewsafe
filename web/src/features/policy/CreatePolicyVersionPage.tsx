/**
 * @author Jemilin Beulah
 */
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { SitePicker } from "@/components/SitePicker";
import { useSelectedSite } from "@/site/useSelectedSite";
import { CreatePolicyVersionForm } from "./CreatePolicyVersionForm";

export function CreatePolicyVersionPage() {
  const { siteId } = useSelectedSite();

  if (!siteId)
    return (
      <AppShell title="Create Policy Version">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask your site administrator."
        />
      </AppShell>
    );

  return <CreatePolicyVersionForm siteId={siteId} siteSwitcher={<SitePicker />} />;
}
