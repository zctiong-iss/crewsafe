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
import type { ResponseTimeBucket } from "@/api/insights";

export function ResponseTimeChart({ buckets }: Readonly<{ buckets: ResponseTimeBucket[] }>) {
  if (buckets.length === 0) {
    return <p className="insights-chart__empty">No actions were acknowledged in this range.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={buckets} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
        <XAxis dataKey="label" stroke="var(--ink-muted)" fontSize={12} />
        <YAxis allowDecimals={false} stroke="var(--ink-muted)" fontSize={12} />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--surface)",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-raised)",
            fontSize: "13px",
          }}
          formatter={(value) => [`${value} actions`, "Acknowledged in band"]}
        />
        <Bar dataKey="count" name="Acknowledged" fill="var(--action)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
