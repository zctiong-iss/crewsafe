/** @author Tang Chee Seng (with assistance from Claude & Gemini) */
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import type { HistoryState } from "./useConditionsStream";
export interface TrendPoint {
  observedAt: string;
  wbgt: number | null;
}

export function ConditionsTrendChart({
  points,
  historyState,
}: Readonly<{
  points: TrendPoint[];
  historyState: HistoryState;
}>) {
  if (points.length < 2) {
    let message: string;
    if (historyState === "loading") {
      message = "Loading the last 4 hours of WBGT readings...";
    } else if (points.length === 0) {
      message = "No WBGT readings in the last 4 hours.";
    } else {
      message = "One WBGT reading is available; another is needed to plot a trend line.";
    }

    return (
      <div className="conditions-chart__empty">
        <p>{message}</p>
      </div>
    );
  }

  const formattedPoints = points.map((p) => ({
    ...p,
    time: p.observedAt.includes("T")
      ? new Date(p.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : p.observedAt,
  }));

  return (
    <div className="conditions-chart">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={formattedPoints} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="time" stroke="var(--ink-muted)" fontSize={12} />
          <YAxis unit="°C" domain={[20, 'auto']} stroke="var(--ink-muted)" fontSize={12} />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--surface)",
              border: "1px solid var(--line-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-raised)",
              fontSize: "13px",
            }}
            formatter={(value) => [`${value ?? ""} °C`, "WBGT"]}
          />
          <Line type="monotone" dataKey="wbgt" stroke="var(--band-low)" strokeWidth={2.5} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
