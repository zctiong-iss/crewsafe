/** @author Tang Chee Seng (with assistance from Claude & Gemini) */
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
export interface TrendPoint {
  observedAt: string;
  wbgt: number | null;
}

export function ConditionsTrendChart({ points }: Readonly<{ points: TrendPoint[] }>) {
  if (points.length < 2) {
    return (
      <div className="conditions-chart__empty">
        <p>Collecting live readings...</p>
        <span className="conditions-chart__empty-sub">
          {points.length === 1
            ? "Initial reading received. Awaiting next NEA update interval to plot trend line."
            : "Awaiting live SSE stream data."}
        </span>
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
