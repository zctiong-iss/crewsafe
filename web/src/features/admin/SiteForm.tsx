/**
 * @author Jemilin Beulah
 */
import { useState, type FormEvent } from "react";
import { ApiError, messageFor } from "@/api/errors";
import { createSite, updateSite, type AdminSite, type SiteWriteRequest } from "@/api/admin";
import { validateSite, type FieldErrors } from "./validateSite";
import "./SiteForm.css";

function toNumberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

type Submit =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string; requestId: string | null };

type SiteFormProps =
  | { mode: "create"; onSaved: (site: AdminSite) => void; onCancel: () => void }
  | { mode: "edit"; site: AdminSite; onSaved: (site: AdminSite) => void; onCancel: () => void };

/**
 * Create and edit are field-identical, so one component handles both rather than duplicating
 * the form twice — matching AdminSiteController.SiteWriteRequest either way.
 */
export function SiteForm(props: SiteFormProps) {
  const editing = props.mode === "edit" ? props.site : null;

  const [name, setName] = useState(editing?.name ?? "");
  const [latitude, setLatitude] = useState(editing ? String(editing.latitude) : "");
  const [longitude, setLongitude] = useState(editing ? String(editing.longitude) : "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submit, setSubmit] = useState<Submit>({ status: "idle" });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const draft: Partial<SiteWriteRequest> = {
      name,
      latitude: toNumberOrUndefined(latitude),
      longitude: toNumberOrUndefined(longitude),
    };
    const found = validateSite(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: SiteWriteRequest = {
      name: name.trim(),
      latitude: Number(latitude),
      longitude: Number(longitude),
    };

    setSubmit({ status: "submitting" });
    const request = props.mode === "edit" ? updateSite(props.site.id, body) : createSite(body);
    request
      .then((site) => props.onSaved(site))
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setSubmit({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
  };

  return (
    <form className="site-form" onSubmit={handleSubmit}>
      <label htmlFor="site-name">Site name</label>
      <input
        id="site-name"
        type="text"
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Bishan Park Landscaping"
      />
      {errors.name && <p className="site-form__error" role="alert">{errors.name}</p>}

      <div className="site-form__coords">
        <div>
          <label htmlFor="site-latitude">Latitude</label>
          <input
            id="site-latitude"
            type="number"
            step="0.000001"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
          />
          {errors.latitude && <p className="site-form__error" role="alert">{errors.latitude}</p>}
        </div>

        <div>
          <label htmlFor="site-longitude">Longitude</label>
          <input
            id="site-longitude"
            type="number"
            step="0.000001"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
          />
          {errors.longitude && <p className="site-form__error" role="alert">{errors.longitude}</p>}
        </div>
      </div>

      {submit.status === "error" && (
        <p className="site-form__error" role="alert">
          {submit.message}
          {submit.requestId && <> Reference <span className="code">{submit.requestId}</span>.</>}
        </p>
      )}

      <div className="site-form__actions">
        <button type="button" className="site-form__cancel" onClick={props.onCancel}>Cancel</button>
        <button type="submit" className="site-form__submit" disabled={submit.status === "submitting"}>
          {submit.status === "submitting" ? "Saving…" : props.mode === "edit" ? "Save Changes" : "Create Site"}
        </button>
      </div>
    </form>
  );
}
