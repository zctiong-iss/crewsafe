/**
 * @author Jemilin Beulah
 */
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { AdminTabs } from "./AdminTabs";
import { RegisterUserForm } from "./RegisterUserForm";

export function RegisterUserPage() {
  const navigate = useNavigate();

  return (
    <AppShell title="Register User" actions={<Link className="NavButton" to="/settings/users">Cancel</Link>}>
      <AdminTabs />
      <RegisterUserForm onRegistered={() => navigate("/settings/users")} />
    </AppShell>
  );
}
