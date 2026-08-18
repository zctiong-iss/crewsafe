/**
 * @author Jemilin Beulah
 */
import { useEffect, useState, type SubmitEvent } from "react";
import type { Role } from "@/api/identity";
import { ApiError, messageFor } from "@/api/errors";
import { fetchAdminSites, registerUser, type AdminSite, type AdminUser, type UserRegisterRequest } from "@/api/admin";
import { roleLabel } from "@/app/navigation";
import { validateUserRegistration, type FieldErrors, type RegistrationMode } from "./validateUserRegistration";
import "./RegisterUserForm.css";

const ROLES: readonly Role[] = ["WORKER", "SUPERVISOR", "SAFETY_MANAGER", "ADMIN"];

type Submit =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string; requestId: string | null };

/**
 * This endpoint's specific error codes (ErrorCode.java), mapped before falling back to the
 * generic, kind-keyed messageFor — kept local to this form rather than added to messageFor
 * itself, which is shared, app-wide infrastructure with no business knowing about one
 * endpoint's error vocabulary.
 */
function messageForRegisterUser(error: ApiError): string {
  switch (error.code) {
    case "COGNITO_PROVISIONING_DISABLED":
      return "Inviting by email isn't enabled in this environment yet. Use \"I already have a Cognito identity\" instead, or ask engineering.";
    case "EMAIL_ALREADY_REGISTERED_IN_COGNITO":
      return "Cognito already has an identity under this email — someone already invited it. Bind that existing identity's sub instead.";
    default:
      return messageFor(error);
  }
}

/**
 * Registers a local app_user row. Two ways to identify the Cognito side, one at a time:
 * inviting by email (default — the backend calls AdminCreateUser directly with a password
 * the admin sets, ADR 0018) or binding an already-existing identity by its sub (the
 * SCRUM-190 synthetic-identity case, or any account created out-of-band).
 *
 * Only the cognitoSub path asks for a separate username: on the email path, there's nothing
 * for it to name that the email doesn't already name, so UserAdminService.register sets
 * app_user.username = email directly and this form never collects one.
 */
export function RegisterUserForm({ onRegistered }: Readonly<{ onRegistered: (user: AdminUser) => void }>) {
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [mode, setMode] = useState<RegistrationMode>("email");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const switchMode = (next: RegistrationMode) => {
    setMode(next);
    setErrors({});
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    const draft: Partial<UserRegisterRequest> = {
      username: mode === "cognitoSub" ? username : undefined,
      email: mode === "email" ? email : undefined,
      password: mode === "email" ? password : undefined,
      cognitoSub: mode === "cognitoSub" ? cognitoSub : undefined,
      displayName,
      role: role || undefined,
    };
    const found = validateUserRegistration(draft, mode);
    setErrors(found);
    if (Object.keys(found).length > 0 || !role) return;

    const body: UserRegisterRequest = {
      displayName: displayName.trim(),
      role,
      siteIds: [...siteIds],
      ...(mode === "email"
        ? { email: email.trim(), password }
        : { username: username.trim(), cognitoSub: cognitoSub.trim() }),
    };

    setSubmit({ status: "submitting" });
    registerUser(body)
      .then((user) => onRegistered(user))
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        if (apiError.code === "USERNAME_ALREADY_REGISTERED") {
          // The email path has no visible username field — the conflict is on the email itself.
          const field = mode === "email" ? "email" : "username";
          setErrors((prev) => ({ ...prev, [field]: "This is already registered — try a different one." }));
          setSubmit({ status: "idle" });
          return;
        }
        setSubmit({ status: "error", message: messageForRegisterUser(apiError), requestId: apiError.requestId });
      });
  };

  return (
    <form className="register-form" onSubmit={handleSubmit}>
      {mode === "email" ? (
        <>
          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane.tan@synthetic.crewsafe.invalid"
          />
          {errors.email && <p className="register-form__error" role="alert">{errors.email}</p>}

          <label htmlFor="register-password">Password</label>
          <input
            id="register-password"
            type="password"
            maxLength={99}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="12+ characters, with upper, lower, a number, and a symbol"
          />
          {errors.password && <p className="register-form__error" role="alert">{errors.password}</p>}

          <button type="button" className="register-form__mode-toggle" onClick={() => switchMode("cognitoSub")}>
            Already have a Cognito identity for this person?
          </button>
        </>
      ) : (
        <>
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
          <button type="button" className="register-form__mode-toggle" onClick={() => switchMode("email")}>
            Invite a brand-new person by email instead
          </button>
        </>
      )}

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
