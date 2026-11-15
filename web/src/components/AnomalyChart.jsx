import { useRef } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "../lib/format.js";
import { exportChartPng } from "../lib/image.js";
import { useRegisterExport } from "./exportContext.js";

const ACCENT = "#f0b84a";
const MUTED = "#7d8ba1"; // muted blue-gray
const TICK = { fill: "#e6e1d6", fontSize: 14 };

// Annual z-score of complete years in the range against the baseline. The parent decides whether to show this at all
// (a range under 12 months is handled there with an explanation). Flagged years (beyond 2 standard deviations) are in the
// accent colour with a white outline, so the flag is not colour alone.
export default function AnomalyChart({ anomaly, context, baselineText }) {
  const ref = useRef(null);
  const { years, sd, baselineYears } = anomaly;
  const flagged = years.filter((y) => y.flag);
  const hasChart = years.length > 0 && sd !== null;

  useRegisterExport("anomaly", () => exportChartPng({
    svgEl: ref.current?.querySelector(".recharts-wrapper > svg.recharts-surface"),
    title: `Annual anomaly (z-score), baseline ${baselineText}`,
    lines: [`${context.regionName}: ${context.aoiText}`, `Period: ${context.start} to ${context.end}`],
    legend: [
      { kind: "swatch", fill: MUTED, label: "Within 2 standard deviations" },
      { kind: "swatch", fill: ACCENT, label: "Flagged (beyond 2 standard deviations)" },
      { kind: "line", stroke: ACCENT, dash: "6 4", label: "+2 and -2 reference lines" },
    ],
    filename: `fire-harmonize_${context.regionId}_anomaly_${context.slug}_${context.start}_${context.end}.png`,
  }));

  return (
    <section className="card" aria-label="Annual anomalies">
      <h2>Annual anomaly (z-score)</h2>
      <p className="hint">How far each complete year is from the baseline average, in standard deviations.</p>
      {years.length === 0 && <p>No complete calendar year (January to December) falls inside the selected range.</p>}
      {years.length > 0 && sd === null && (
        <p>The baseline has {baselineYears} complete {baselineYears === 1 ? "year" : "years"} or no year-to-year spread, so z-scores are undefined.</p>
      )}
      {hasChart && (
        <>
          <div ref={ref}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={years} margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#262b36" vertical={false} />
                <XAxis dataKey="year" stroke="#aab2c0" tick={TICK} interval={3} />
                <YAxis stroke="#aab2c0" tick={TICK} width={40} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} contentStyle={{ background: "#151820", border: "1px solid #3a4150", color: "#f4efe5", fontSize: 14 }}
                  formatter={(v, _n, p) => [`${v.toFixed(2)} (${fmt(p.payload.total)} detections)`, "z-score"]} labelFormatter={(y) => String(y)} />
                <ReferenceLine y={0} stroke="#aab2c0" />
                <ReferenceLine y={2} stroke={ACCENT} strokeDasharray="6 4" label={{ value: "+2", fill: ACCENT, position: "right", fontSize: 14 }} />
                <ReferenceLine y={-2} stroke={ACCENT} strokeDasharray="6 4" label={{ value: "-2", fill: ACCENT, position: "right", fontSize: 14 }} />
                <Bar dataKey="z" isAnimationActive={false}>
                  {years.map((y) => <Cell key={y.year} fill={y.flag ? ACCENT : MUTED} stroke={y.flag ? "#ffffff" : "none"} strokeWidth={2} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p>
            {flagged.length === 0 ? "No year is beyond 2 standard deviations of the baseline."
              : `Flagged (beyond 2 standard deviations): ${flagged.map((y) => `${y.year} (${y.z > 0 ? "+" : ""}${y.z.toFixed(1)})`).join(", ")}.`}
          </p>
          <p className="hint">Baseline: {baselineYears} complete years, sample standard deviation. Annual totals that include estimated months carry the same uncertainty.</p>
        </>
      )}
    </section>
  );
}
