/**
 * @author Jemilin Beulah
 */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Wordmark } from "./Wordmark";
import { useAuth, useCurrentUser } from "@/auth/useAuth";
import { navigationFor, roleLabel } from "@/app/navigation";
import "./AppShell.css";

/**
 * The frame every signed-in page renders inside.
 *
 * Navigation is derived from the user's role rather than hardcoded to the supervisor view
 * in the prototypes. A worker and an administrator see genuinely different products, and
 * building that in now is much cheaper than retrofitting it around a supervisor-shaped
 * shell later.
 */
export function AppShell({ title, subtitle, siteSwitcher, actions, children }: {
  title: string;
  subtitle?: string;
  siteSwitcher?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const user = useCurrentUser();
  const { signOut } = useAuth();
  const items = navigationFor(user.role);

  return (
    <div className="shell">
      <a className="shell__skip" href="#main">
        Skip to content
      </a>

      <header className="shell__sidebar">
        <div className="shell__brand">
          <Wordmark tone="dark" />
        </div>

        <nav className="shell__nav" aria-label="Sections">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `shell__nav-item${isActive ? " shell__nav-item--active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="shell__account">
          <p className="shell__account-name">{user.displayName}</p>
          <p className="shell__account-role">{roleLabel(user.role)}</p>
          <button type="button" className="shell__signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="shell__body">
        <div className="shell__topbar">
          <div>
            <h1 className="shell__title">{title}</h1>
            {subtitle && <p className="shell__subtitle">{subtitle}</p>}
            {siteSwitcher && <div className="shell__site-switcher">{siteSwitcher}</div>}
          </div>
          {actions && <div className="shell__actions">{actions}</div>}
        </div>

        <main id="main" className="shell__main">
          {children}
        </main>
      </div>
    </div>
  );
}
