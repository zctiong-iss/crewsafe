/** @author Tang Chee Seng (with assistance from Claude) */
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { ComplianceBucket } from "@/api/insights";

// S6759: props are readonly.
export function ComplianceChart({ buckets }: Readonly<{ buckets: ComplianceBucket[] }>) {
  // Fewer than one bar is not a chart. An honest empty state, not an axis with nothing on it.
  if (buckets.length === 0) {
    return <p className="insights-chart__empty">No safety actions were dispatched in this range.</p>;
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
        />
        <Legend />
        {/* stackId ties the two bars into one column; names drive the legend + tooltip text,
            so the meaning survives even for a colour-blind reader who can't separate the fills. */}
        <Bar stackId="actions" dataKey="actedOn" name="Acted on" fill="var(--status-ok)" />
        <Bar stackId="actions" dataKey="lapsed" name="Lapsed (swept)" fill="var(--band-high)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
