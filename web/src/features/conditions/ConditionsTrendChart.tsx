/** @author Tang Chee Seng (with assistance from Claude) */
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

export interface TrendPoint {
  observedAt: string;
  wbgt: number | null;
}

export function ConditionsTrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <p>Collecting readings...</p>;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={points}>
        <XAxis dataKey="observedAt" />
        <YAxis unit="°C" />
        <Tooltip />
        <Line type="monotone" dataKey="wbgt" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}