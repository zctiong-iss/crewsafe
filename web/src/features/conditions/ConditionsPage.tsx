/** @author Jemilin Beulah, Tang Chee Seng */
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { SitePicker } from "@/components/SitePicker";
import { useSelectedSite } from "@/site/useSelectedSite";
import { type subscribeToConditions } from "@/api/conditionsStream";
import type { ConditionsHistoryLoader } from "./useConditionsStream";
import { ConditionsPanel } from "./ConditionsPanel";

/**
 * @param subscribe Overrides the live SSE transport. Only ever passed in tests — production
 * always takes {@link ConditionsPanel}'s own default, exactly as before this prop existed.
 */
export function ConditionsPage({
  subscribe,
  loadHistory,
}: {
  subscribe?: typeof subscribeToConditions;
  loadHistory?: ConditionsHistoryLoader;
} = {}) {
  const { siteId } = useSelectedSite();

  if (!siteId)
    return (
      <AppShell title="Conditions">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask your site administrator."
        />
      </AppShell>
    );

  return (
    <ConditionsPanel
      siteId={siteId}
      subscribe={subscribe}
      loadHistory={loadHistory}
      siteSwitcher={<SitePicker />}
    />
  );
}
