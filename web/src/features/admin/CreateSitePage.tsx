/**
 * @author Jemilin Beulah
 */
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { SiteForm } from "./SiteForm";
import { AdminTabs } from "./AdminTabs";

export function CreateSitePage() {
  const navigate = useNavigate();

  return (
    <AppShell title="Create Site">
      <AdminTabs />
      <SiteForm mode="create" onSaved={() => navigate("/settings")} onCancel={() => navigate("/settings")} />
    </AppShell>
  );
}
