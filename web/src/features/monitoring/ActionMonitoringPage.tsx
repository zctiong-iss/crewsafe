/** @author Tang Chee Seng (with assistance from Claude) */
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { SitePicker } from "@/components/SitePicker";
import { useSelectedSite } from "@/site/useSelectedSite";
import { type subscribeToActionStatus } from "@/api/actionStatusStream";
import { type subscribeToConcerns } from "@/api/concernStream";
import { ActionMonitoringPanel } from "./ActionMonitoringPanel";

/**
 * @param subscribe Overrides the live SSE transport. Only ever passed in tests — production
 * always takes {@link ActionMonitoringPanel}'s own default.
 */
export function ActionMonitoringPage({
  subscribe,
  subscribeConcerns,
}: {
  subscribe?: typeof subscribeToActionStatus;
  subscribeConcerns?: typeof subscribeToConcerns;
} = {}) {
  const { siteId } = useSelectedSite();

  if (!siteId)
    return (
      <AppShell title="Team Monitor">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask your site administrator."
        />
      </AppShell>
    );

  return (
    <ActionMonitoringPanel
      siteId={siteId}
      subscribe={subscribe}
      subscribeConcerns={subscribeConcerns}
      siteSwitcher={<SitePicker />}
    />
  );
}
