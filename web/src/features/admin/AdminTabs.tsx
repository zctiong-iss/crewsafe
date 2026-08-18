/**
 * @author Jemilin Beulah
 */
import { NavLink } from "react-router-dom";
import "./Admin.css";

/** The two sections of the admin console — Sites is the /settings default, Users is /settings/users. */
export function AdminTabs() {
  return (
    <nav className="admin-tabs" aria-label="Admin sections">
      <NavLink to="/settings" end className={({ isActive }) => `admin-tabs__link${isActive ? " admin-tabs__link--active" : ""}`}>
        Sites
      </NavLink>
      <NavLink to="/settings/users" className={({ isActive }) => `admin-tabs__link${isActive ? " admin-tabs__link--active" : ""}`}>
        Users
      </NavLink>
    </nav>
  );
}
