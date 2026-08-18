/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { fetchForecast, type SiteForecast, type ForecastBasis } from "@/api/forecast";
import { ApiError, messageFor } from "@/api/errors";

type Load =
  | { status: "loading" }
  | { status: "loaded"; forecast: SiteForecast }
  | { status: "unavailable" } // an expected outcome, not an error
  | { status: "error"; message: string };

/**
 * Basis -> human label + trust line, as a total Record over the union (S3358: NOT a nested
 * ternary). A new ForecastBasis value becomes a compile error here rather than an unlabelled chip.
 */
const BASIS_COPY: Record<ForecastBasis, { label: string; trust: string; tone: string }> = {
  MODEL: {
    label: "Live model",
    trust: "Full-confidence prediction from the trained model.",
    tone: "ok",
  },
  MODEL_IMPUTED: {
    label: "Model (gap-filled)",
    trust: "Model prediction with a few missing readings interpolated — interval widened.",
    tone: "waiting",
  },
  TREND: {
    label: "Trend estimate",
    trust: "Model context unavailable; extrapolating recent readings. Treat as indicative.",
    tone: "waiting",
  },
  PERSISTENCE: {
    label: "Last reading held",
    trust: "Weakest fallback: the last real reading carried forward. Verify before acting.",
    tone: "none",
  },
};

export function FallbackStatusPanel({ siteId }: Readonly<{ siteId: string }>) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setLoad({ status: "loading" });

    fetchForecast(siteId)
      .then((forecast) => active && setLoad({ status: "loaded", forecast }))
      .catch((error: unknown) => {
        if (!active) return;
        // "Forecast unavailable" is an expected 503 (ForecastUnavailableException), not a failure
        // to report as broken. 503 maps to kind "server" in the client.
        if (error instanceof ApiError && error.kind === "server") {
          setLoad({ status: "unavailable" });
          return;
        }
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError) });
      });

    return () => {
      active = false;
    };
  }, [siteId]);

  if (load.status === "loading") {
    return <output className="insights__loading">Checking forecast status</output>;
  }
  if (load.status === "unavailable") {
    return (
      <EmptyState
        headline="No forecast available for this site"
        body="The newest weather reading is too old to forecast from. The system is being honest rather than showing a number it cannot stand behind."
      />
    );
  }
  if (load.status === "error") {
    return <EmptyState headline="Could not check forecast status" body={load.message} />;
  }

  const f = load.forecast;
  const copy = BASIS_COPY[f.basis];
  const intervalWidth = (f.confidenceIntervalUpper - f.confidenceIntervalLower).toFixed(1);

  return (
    <div className="fallback">
      <div className="fallback__header">
        <span className={`pill fallback__basis fallback__basis--${copy.tone}`}>{copy.label}</span>
        {f.degraded && <span className="pill fallback__degraded">Running degraded</span>}
      </div>
      <p className="fallback__trust">{copy.trust}</p>
      <dl className="fallback__facts">
        <div>
          <dt>Predicted WBGT (+{f.horizonMinutes}m)</dt>
          <dd>{f.predictedValue} °C</dd>
        </div>
        <div>
          <dt>Confidence interval</dt>
          <dd>± {intervalWidth} °C</dd>
        </div>
        <div>
          <dt>Newest input age</dt>
          <dd>{f.inputAgeMinutes} min</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>
            <span className="code">{f.modelVersion}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
