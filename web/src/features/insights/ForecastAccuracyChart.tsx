/** @author Tang Chee Seng (with assistance from Claude) */
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export function ForecastAccuracyChart({
  rows,
}: Readonly<{ rows: { band: string; mae: number }[] }>) {
  if (rows.length === 0) {
    return <p className="insights-chart__empty">No band-level accuracy in the evaluation set.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="band" stroke="var(--ink-muted)" fontSize={12} />
        <YAxis unit="°C" stroke="var(--ink-muted)" fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-raised)",
            fontSize: "13px",
          }}
          formatter={(value) => [`${value} °C`, "Mean abs. error"]}
        />
        <Bar dataKey="mae" name="MAE" fill="var(--action)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
