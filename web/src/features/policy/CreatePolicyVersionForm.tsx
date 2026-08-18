/**
 * @author Jemilin Beulah
 */
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ApiError, messageFor } from "@/api/errors";
import {
  createPolicyVersion,
  fetchActivePolicyVersion,
  type PolicyVersion,
  type PolicyVersionCreateRequest,
} from "@/api/policy";
import { validatePolicyVersion, type FieldErrors } from "./validatePolicyVersion";
import { THRESHOLD_GROUPS, type ThresholdField } from "./thresholds";
import "./CreatePolicyVersionForm.css";

const ALL_THRESHOLD_FIELDS: readonly ThresholdField[] = THRESHOLD_GROUPS.flatMap((g) => [
  g.light,
  g.moderate,
  g.heavy,
]);

const INTENSITY_LABEL = { light: "Light", moderate: "Moderate", heavy: "Heavy" } as const;

type ThresholdStrings = Record<ThresholdField, string>;

function blankThresholds(): ThresholdStrings {
  return Object.fromEntries(ALL_THRESHOLD_FIELDS.map((f) => [f, ""])) as ThresholdStrings;
}

function thresholdsFrom(version: PolicyVersion): ThresholdStrings {
  return Object.fromEntries(
    ALL_THRESHOLD_FIELDS.map((f) => [f, String(version[f])]),
  ) as ThresholdStrings;
}

function toNumberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

type Prefill =
  | { status: "loading" }
  | { status: "ready"; active: PolicyVersion | null }
  | { status: "unavailable" };

type Submit =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "created"; version: PolicyVersion }
  | { status: "error"; message: string; requestId: string | null };

export function CreatePolicyVersionForm({ siteId, siteSwitcher }: { siteId: string; siteSwitcher?: ReactNode }) {
  const [prefill, setPrefill] = useState<Prefill>({ status: "loading" });
  const [versionLabel, setVersionLabel] = useState("");
  const [source, setSource] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [notes, setNotes] = useState("");
  const [thresholds, setThresholds] = useState<ThresholdStrings>(blankThresholds());
  const [wbgtEmergencyStop, setWbgtEmergencyStop] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submit, setSubmit] = useState<Submit>({ status: "idle" });

  useEffect(() => {
    let active = true;
    fetchActivePolicyVersion(siteId)
      .then((version) => {
        if (!active) return;
        setPrefill({ status: "ready", active: version });
        // Only the thresholds carry forward — a real revision is a tweak to the numbers, not
        // a reason to reuse the previous label, source or effective date.
        if (version) {
          setThresholds(thresholdsFrom(version));
          setWbgtEmergencyStop(String(version.wbgtEmergencyStop));
        }
      })
      .catch(() => active && setPrefill({ status: "unavailable" }));
    return () => {
      active = false;
    };
  }, [siteId]);

  const updateThreshold = (field: ThresholdField, value: string) =>
    setThresholds((prev) => ({ ...prev, [field]: value }));

  const buildValidationDraft = (): Partial<PolicyVersionCreateRequest> => ({
    versionLabel,
    source,
    effectiveDate: effectiveDate || undefined,
    wbgtEmergencyStop: toNumberOrUndefined(wbgtEmergencyStop),
    ...Object.fromEntries(
      ALL_THRESHOLD_FIELDS.map((f) => [f, toNumberOrUndefined(thresholds[f])]),
    ),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = buildValidationDraft();
    const found = validatePolicyVersion(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: PolicyVersionCreateRequest = {
      versionLabel: versionLabel.trim(),
      source: source.trim(),
      effectiveDate,
      wbgtEmergencyStop: Number(wbgtEmergencyStop),
      ...(Object.fromEntries(
        ALL_THRESHOLD_FIELDS.map((f) => [f, Number(thresholds[f])]),
      ) as Record<ThresholdField, number>),
      ...(notes.trim() !== "" ? { notes: notes.trim() } : {}),
    };

    setSubmit({ status: "submitting" });
    createPolicyVersion(siteId, body)
      .then((version) => setSubmit({ status: "created", version }))
      .catch((error: unknown) => {
        const apiError = error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setSubmit({ status: "error", message: messageFor(apiError), requestId: apiError.requestId });
      });
  };

  if (prefill.status === "loading") {
    return (
      <AppShell title="Create Policy Version" siteSwitcher={siteSwitcher}>
        <output style={{ display: "block" }}>Loading current policy…</output>
      </AppShell>
    );
  }

  if (submit.status === "created") {
    return (
      <AppShell title="Create Policy Version" siteSwitcher={siteSwitcher}>
        <EmptyState
          headline="Policy version created"
          body={
            submit.version.status === "ACTIVE"
              ? `${submit.version.versionLabel} is now the site's active policy.`
              : `${submit.version.versionLabel} was saved as a draft. Activate it from the catalogue when it should take effect.`
          }
          action={<Link to="/policy" className="NavButton">Back to Heat Policy</Link>}
        />
      </AppShell>
    );
  }

  return (
    <AppShell title="Create Policy Version" siteSwitcher={siteSwitcher}>
      <form className="policy-form" onSubmit={handleSubmit}>
        {prefill.status === "unavailable" && (
          <output className="policy-form__note">
            Could not load the site's current policy to pre-fill thresholds. Enter them from scratch below.
          </output>
        )}
        {prefill.status === "ready" && !prefill.active && (
          <output className="policy-form__note">
            This site has no policy version yet — this one becomes active immediately once created.
          </output>
        )}

        <section className="policy-form__section">
          <h2 className="policy-form__section-title">Version details</h2>

          <label htmlFor="versionLabel">Version label</label>
          <input
            id="versionLabel"
            type="text"
            maxLength={64}
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
            placeholder="e.g. MOM-WBGT-2026.2"
          />
          {errors.versionLabel && <p className="policy-form__error" role="alert">{errors.versionLabel}</p>}

          <label htmlFor="source">Source</label>
          <input
            id="source"
            type="text"
            maxLength={255}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="e.g. MOM Heat Stress Advisory, revised 2026"
          />
          {errors.source && <p className="policy-form__error" role="alert">{errors.source}</p>}

          <label htmlFor="effectiveDate">Effective date</label>
          <input
            id="effectiveDate"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
          {errors.effectiveDate && <p className="policy-form__error" role="alert">{errors.effectiveDate}</p>}

          <label htmlFor="notes">Notes (optional)</label>
          <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </section>

        <section className="policy-form__section">
          <h2 className="policy-form__section-title">WBGT thresholds (°C)</h2>
          <p className="policy-form__hint">
            Each level must be light ≥ moderate ≥ heavy. Every value must be at least 15°C.
          </p>

          {THRESHOLD_GROUPS.map((group) => (
            <fieldset key={group.level} className="policy-form__row card">
              <legend>{group.level}</legend>

              {(["light", "moderate", "heavy"] as const).map((intensity) => {
                const field = group[intensity];
                const id = `${field}`;
                return (
                  <div key={field} className="policy-form__threshold">
                    <label htmlFor={id}>{INTENSITY_LABEL[intensity]}</label>
                    <input
                      id={id}
                      type="number"
                      step="0.1"
                      value={thresholds[field]}
                      onChange={(e) => updateThreshold(field, e.target.value)}
                    />
                    {errors[field] && <p className="policy-form__error" role="alert">{errors[field]}</p>}
                  </div>
                );
              })}
            </fieldset>
          ))}
        </section>

        <section className="policy-form__section">
          <h2 className="policy-form__section-title">Legacy WBGT threshold</h2>
          <p>This field is retained for compatibility and is not enforced as a stop-work rule.</p>
          <label htmlFor="wbgtEmergencyStop">WBGT emergency stop (°C)</label>
          <input
            id="wbgtEmergencyStop"
            type="number"
            step="0.1"
            value={wbgtEmergencyStop}
            onChange={(e) => setWbgtEmergencyStop(e.target.value)}
          />
          {errors.wbgtEmergencyStop && (
            <p className="policy-form__error" role="alert">{errors.wbgtEmergencyStop}</p>
          )}
        </section>

        {submit.status === "error" && (
          <p className="policy-form__error" role="alert">
            {submit.message}
            {submit.requestId && <> Reference <span className="code">{submit.requestId}</span>.</>}
          </p>
        )}

        <div className="policy-form__actions">
          <Link className="policy-form__back" to="/policy">Cancel</Link>
          <button type="submit" disabled={submit.status === "submitting"}>
            {submit.status === "submitting" ? "Creating…" : "Create Version"}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
