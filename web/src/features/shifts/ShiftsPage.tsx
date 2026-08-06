/** @author Tang Chee Seng (with assistance from Claude) */
import { useCurrentUser } from "@/auth/useAuth";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ShiftList } from "./ShiftList";

export function ShiftsPage() {
  const user = useCurrentUser();

  if (user.siteIds.length === 0) {
    return (
      <AppShell title="Shifts & tasks">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask your system administrator."
        />
      </AppShell>
    );
  }

  return <ShiftList siteIds={user.siteIds} />;
}