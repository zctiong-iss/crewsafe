/** @author Tang Chee Seng (with assistance from Claude) */
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { fetchModelStatus, selectHorizon, bandRows, type ModelStatus } from "@/api/forecast";
import { ApiError, messageFor } from "@/api/errors";
import { ForecastAccuracyChart } from "./ForecastAccuracyChart";

type Load =
  | { status: "loading" }
  | { status: "loaded"; status_: ModelStatus }
  | { status: "error"; message: string };

// Recall is 0..1; show as a percentage. Guard is trivial so this stays a one-liner (no S3358).
function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ForecastAccuracyPanel() {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  // No siteId dependency — global. Fetch once on mount.
  useEffect(() => {
    let active = true;
    fetchModelStatus()
      .then((status_) => active && setLoad({ status: "loaded", status_ }))
      .catch((error: unknown) => {
        if (!active) return;
        const apiError =
          error instanceof ApiError ? error : new ApiError("server", "Unknown", null, null);
        setLoad({ status: "error", message: messageFor(apiError) });
      });
    return () => {
      active = false;
    };
  }, []);

  if (load.status === "loading") {
    return <output className="insights__loading">Loading model accuracy</output>;
  }
  if (load.status === "error") {
    return <EmptyState headline="Could not load model accuracy" body={load.message} />;
  }

  const model = load.status_;
  const horizon = selectHorizon(model);

  if (horizon === null) {
    return (
      <EmptyState
        headline="No accuracy metrics yet"
        body="The deployed model has no completed validation run to report accuracy from."
      />
    );
  }

  const metrics = horizon.metrics;
  const rows = bandRows(metrics);

  return (
    <>
      <p className="insights__panel-note">
        Global model performance on held-out data ({metrics.sampleCount} samples, +{horizon.key}m
        horizon), model <span className="code">{model.modelVersion}</span>. This describes the
        model, not any one site.
      </p>

      <section className="insights__stats" aria-label="Model accuracy metrics">
        <Stat label="MAE" value={`${metrics.mae.toFixed(2)} °C`} />
        <Stat label="RMSE" value={`${metrics.rmse.toFixed(2)} °C`} />
        <Stat label="Recall ≥32 °C" value={pct(metrics.recallAtLeast32)} />
        <Stat label="Recall ≥33 °C" value={pct(metrics.recallAtLeast33)} />
      </section>

      {/* The honest core of "how far to trust the model": when the deployed model is not approved
          for inference, the server says why — surface it, don't hide it behind green numbers. */}
      {!model.approvedForInference && (
        <p className="fallback__degraded-note" role="alert">
          This model is not currently approved for production inference
          {model.approvalBlocker ? ` — ${model.approvalBlocker}` : ""}. Treat forecasts with extra
          caution and escalate to the ML owner.
        </p>
      )}

      <h3 className="insights__panel-title">Error by WBGT band</h3>
      <ForecastAccuracyChart rows={rows} />

      <table className="visually-hidden">
        <caption>Mean absolute error by WBGT band</caption>
        <thead>
          <tr>
            <th scope="col">Band</th>
            <th scope="col">MAE (°C)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.band}>
              <th scope="row">{row.band}</th>
              <td>{row.mae}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Stat({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="insights__stat card">
      <span className="eyebrow">{label}</span>
      <span className="insights__stat-value">{value}</span>
    </div>
  );
}
