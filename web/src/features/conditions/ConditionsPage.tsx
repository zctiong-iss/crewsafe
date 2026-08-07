/** @author Tang Chee Seng (with assistance from Claude) */
import { useCurrentUser } from "@/auth/useAuth";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ConditionsPanel } from "./ConditionsPanel";

export function ConditionsPage() {
  const user = useCurrentUser();
  const siteId = user.siteIds[0];

  if (!siteId)
    return (
      <AppShell title="Conditions">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask your site administrator."
        />
      </AppShell>
    );

  return <ConditionsPanel siteId={siteId} />;
}