import { useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, MONTHS } from "../lib/format.js";
import { exportChartPng } from "../lib/image.js";
import { useRegisterExport } from "./exportContext.js";

const compact = (v) => v.toLocaleString("en-US", { notation: "compact" });
const MEDIAN = "#7d8ba1"; // muted blue-gray
const ACCENT = "#f0b84a";
const TICK = { fill: "#e6e1d6", fontSize: 14 };

// Monthly median over the baseline years as bars, with one selectable year laid beside it in the accent colour.
export default function SeasonalProfile({ baseline, rangeRows, context }) {
  const ref = useRef(null);
  const years = [...new Set(rangeRows.map((r) => Number(r.month.slice(0, 4))))];
  const [picked, setPicked] = useState(null);
  const year = years.includes(picked) ? picked : years[years.length - 1];
  const byMonth = new Map(rangeRows.filter((r) => Number(r.month.slice(0, 4)) === year).map((r) => [Number(r.month.slice(5, 7)), r.count]));
  const data = baseline.map((b) => ({ name: MONTHS[b.month - 1], median: b.median, year: byMonth.get(b.month) ?? null }));

  useRegisterExport("seasonal", () => exportChartPng({
    svgEl: ref.current?.querySelector(".recharts-wrapper > svg.recharts-surface"),
    title: `Seasonal profile, overlay year ${year}`,
    lines: [`${context.regionName}: ${context.aoiText}`, `Period: ${context.start} to ${context.end}`],
    legend: [{ kind: "swatch", fill: MEDIAN, label: "Baseline median" }, { kind: "swatch", fill: ACCENT, label: String(year) }],
    filename: `fire-harmonize_${context.regionId}_seasonal-profile_${context.slug}_${context.start}_${context.end}.png`,
  }));

  return (
    <section className="card" aria-label="Seasonal profile">
      <div className="card-head">
        <h2>Seasonal profile</h2>
        <label className="inline">
          <span>Year shown</span>
          <select value={year} onChange={(e) => setPicked(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <div ref={ref}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barGap={2}>
            <CartesianGrid stroke="#262b36" vertical={false} />
            <XAxis dataKey="name" stroke="#aab2c0" tick={TICK} interval={0} tickFormatter={(m) => m[0]} />
            <YAxis stroke="#aab2c0" tick={TICK} tickFormatter={compact} width={52} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} contentStyle={{ background: "#151820", border: "1px solid #3a4150", color: "#f4efe5", fontSize: 14 }}
              formatter={(v) => (v === null ? "no data" : fmt(v))} />
            <Legend wrapperStyle={{ fontSize: 14 }} />
            <Bar dataKey="median" name="Baseline median" fill={MEDIAN} isAnimationActive={false} />
            <Bar dataKey="year" name={String(year)} fill={ACCENT} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
