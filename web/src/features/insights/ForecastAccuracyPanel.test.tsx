/** @author Tang Chee Seng (with assistance from Claude) */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { ForecastAccuracyPanel } from "./ForecastAccuracyPanel";
import "@testing-library/jest-dom/vitest";

const BASE = "http://localhost:8080";

const modelStatus = (approved: boolean) => ({
  modelVersion: "wbgt-1.2.0",
  approvedForInference: approved,
  approvalBlocker: approved ? null : "does not beat the persistence baseline",
  horizons: {
    "30": {
      mae: 0.42,
      rmse: 0.61,
      meanBias: -0.05,
      macroF1: 0.78,
      recallAtLeast32: 0.91,
      recallAtLeast33: 0.88,
      maeByActualBand: { "<31": 0.3, "31–32": 0.45, "≥33": 0.7 },
      confusionMatrix: [
        [10, 1],
        [2, 8],
      ],
      sampleCount: 500,
    },
  },
});

describe("ForecastAccuracyPanel", () => {
  it("shows the deployed model's MAE and high-risk recall", async () => {
    server.use(
      http.get(`${BASE}/api/v1/ml/model-status`, () => HttpResponse.json(modelStatus(true))),
    );
    render(<ForecastAccuracyPanel />);
    expect(await screen.findByText("0.42 °C")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("raises an honest alert when the model is not approved for inference", async () => {
    server.use(
      http.get(`${BASE}/api/v1/ml/model-status`, () => HttpResponse.json(modelStatus(false))),
    );
    render(<ForecastAccuracyPanel />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/not currently approved/i);
    expect(alert).toHaveTextContent(/persistence baseline/i);
  });
});
