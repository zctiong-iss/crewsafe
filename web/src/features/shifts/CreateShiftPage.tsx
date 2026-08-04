/** @author Tang Chee Seng (with assistance from Claude) */

import { useCurrentUser } from "@/auth/useAuth";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { CreateShiftForm } from "./CreateShiftForm";

export function CreateShiftPage() {
  const user = useCurrentUser();
  const siteId = user.siteIds[0]; // To create single-site path; to update to multi-site path as part of SCRUM-134 if prioritised later
  
  if (!siteId) {
    return (
      <AppShell title="Create shift">
        <EmptyState
          headline="No site assigned"
          body="You have not been assigned to a site yet. Ask approach the system administrator."
        />
      </AppShell>
    );
  }

  return <CreateShiftForm siteId={siteId} />;
}