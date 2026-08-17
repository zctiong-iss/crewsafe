/**
 * @author Jemilin Beulah
 */
import { useEffect, useState, type FormEvent } from "react";
import type { Role } from "@/api/identity";
import { ApiError, messageFor } from "@/api/errors";
import { fetchAdminSites, registerUser, type AdminSite, type AdminUser, type UserRegisterRequest } from "@/api/admin";
import { roleLabel } from "@/app/navigation";
import { validateUserRegistration, type FieldErrors } from "./validateUserRegistration";
import "./RegisterUserForm.css";

const ROLES: readonly Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];

type Submit =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string; requestId: string | null };

/**
 * Registers a local app_user row for a Cognito identity that already exists — the admin
 * pastes in a cognitoSub obtained however accounts are created today (AWS Console, or the
 * SCRUM-190 CI pipeline). This form never talks to Cognito itself.
 */
export function RegisterUserForm({ onRegistered }: { onRegistered: (user: AdminUser) => void }) {
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [username, setUsername] = useState("");
  const [cognitoSub, setCognitoSub] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [siteIds, setSiteIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submit, setSubmit] = useState<Submit>({ status: "idle" });

  useEffect(() => {
    let active = true;
    fetchAdminSites()
      .then((all) => active && setSites(all.filter((s) => !s.archived)))
      .catch(() => {
        // Non-fatal — the form still works with an empty site list, just with nothing to grant yet.
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleSite = (siteId: string) => {
    setSiteIds((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const draft: Partial<UserRegisterRequest> = {
      username,
      cognitoSub,
      displayName,
      role: role || undefined,
    };
    const found = validateUserRegistration(draft);
    setErrors(found);
    if (Object.keys(found).length > 0 || !role) return;

    const body: UserRegisterRequest = {
      username: username.trim(),
      cognitoSub: cognitoSub.trim(),
      displayName: displayName.trim(),
      role,
      siteIds: [...siteIds],
    };

    setSubmit({ status: "submitting" });
    registerUser(body)
      .then((user) => onRegistered(user))
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setSubmit({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
  };

  return (
    <form className="register-form" onSubmit={handleSubmit}>
      <label htmlFor="register-username">Username</label>
      <input
        id="register-username"
        type="text"
        maxLength={64}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="e.g. jane.tan"
      />
      {errors.username && <p className="register-form__error" role="alert">{errors.username}</p>}

      <label htmlFor="register-sub">Cognito sub</label>
      <input
        id="register-sub"
        type="text"
        value={cognitoSub}
        onChange={(e) => setCognitoSub(e.target.value)}
        placeholder="The sub for an identity already created in Cognito"
      />
      {errors.cognitoSub && <p className="register-form__error" role="alert">{errors.cognitoSub}</p>}

      <label htmlFor="register-display-name">Display name</label>
      <input
        id="register-display-name"
        type="text"
        maxLength={120}
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
      />
      {errors.displayName && <p className="register-form__error" role="alert">{errors.displayName}</p>}

      <label htmlFor="register-role">Role</label>
      <select id="register-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="">Choose a role…</option>
        {ROLES.map((r) => (
          <option key={r} value={r}>{roleLabel(r)}</option>
        ))}
      </select>
      {errors.role && <p className="register-form__error" role="alert">{errors.role}</p>}

      <fieldset className="register-form__sites">
        <legend>Sites</legend>
        {sites.length === 0 && <p className="register-form__hint">No sites to assign yet.</p>}
        {sites.map((site) => (
          <label key={site.id} className="register-form__site-option">
            <input
              type="checkbox"
              checked={siteIds.has(site.id)}
              onChange={() => toggleSite(site.id)}
            />
            {site.name}
          </label>
        ))}
      </fieldset>

      {submit.status === "error" && (
        <p className="register-form__error" role="alert">
          {submit.message}
          {submit.requestId && <> Reference <span className="code">{submit.requestId}</span>.</>}
        </p>
      )}

      <div className="register-form__actions">
        <button type="submit" disabled={submit.status === "submitting"}>
          {submit.status === "submitting" ? "Registering…" : "Register User"}
        </button>
      </div>
    </form>
  );
}
