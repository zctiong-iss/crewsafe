import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";

/**
 * A destination that exists in navigation but has no feature behind it yet.
 *
 * Deliberately not a 404. The section is real and planned; saying so is more honest than
 * pretending the URL is wrong, and it keeps the shell navigable while features land.
 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <AppShell title={title}>
      <EmptyState
        headline={`${title} is not built yet`}
        body="This section is part of the plan but has no features behind it so far. Nothing is broken — there is simply nothing here to show you."
      />
    </AppShell>
  );
}
