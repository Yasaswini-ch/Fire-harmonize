import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, monthLabel } from "../lib/format.js";
import { jumpText } from "../lib/falseJump.js";

const RAW = "#e69f00"; // colour-blind-safe orange
const HARM = "#56b4e9"; // colour-blind-safe sky blue
const TICK = { fill: "#e6e1d6", fontSize: 14 };
const VIEWS = [["raw", "Raw splice"], ["harmonized", "Harmonized"], ["both", "Both"]]; // before, after, then together

// The project's thesis in one chart: the raw counts of the two satellites, spliced as they are, jump when VIIRS starts; the
// harmonized series does not. Whole region and the full record, whatever area is drawn on the calendar page.
export default function FalseJump({ jump, regionName }) {
  const [view, setView] = useState("raw"); // open on the problem; the visitor switches to the fix
  if (!jump) return null;
  const showRaw = view !== "harmonized";
  const showHarm = view !== "raw";
  const text = jumpText(jump, regionName);
  const ticks = jump.points.filter((p) => p.month.endsWith("-01") && Number(p.month.slice(0, 4)) % 4 === 0).map((p) => p.month);
  return (
    <div className="false-jump">
      <div className="card-head">
        <h2>The false jump, and how harmonizing removes it</h2>
        <div className="seg" role="group" aria-label="Series shown">
          {VIEWS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} className={view === id ? "" : "ghost"} onClick={() => setView(id)}>{label}</button>
          ))}
        </div>
      </div>
      <p className="hint">
        Monthly detections for the whole of {regionName}. "Raw splice" is MODIS as counted until VIIRS starts, then VIIRS as counted, with
        no adjustment. It is not your drawn area: the raw counts per cell are not part of the site's data.
      </p>
      <div role="img" aria-label={text ?? `Monthly detections for ${regionName}, raw and harmonized`}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={jump.points} margin={{ top: 16, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#262b36" vertical={false} />
            <XAxis dataKey="month" stroke="#aab2c0" tick={TICK} ticks={ticks} tickFormatter={(m) => m.slice(0, 4)} />
            <YAxis stroke="#aab2c0" tick={TICK} width={56} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
            <Tooltip cursor={{ stroke: "#aab2c0" }} contentStyle={{ background: "#151820", border: "1px solid #3a4150", color: "#f4efe5", fontSize: 14 }}
              labelFormatter={(m) => monthLabel(m)} formatter={(v, name) => [fmt(v), name]} />
            <ReferenceLine x={jump.firstViirsMonth} stroke="#aab2c0" strokeDasharray="4 4"
              label={{ value: `VIIRS starts, ${monthLabel(jump.firstViirsMonth)}`, fill: "#e6e1d6", position: "insideTopLeft", fontSize: 14 }} />
            {showHarm && <Area type="monotone" dataKey={(d) => [d.lo, d.hi]} stroke="none" fill={HARM} fillOpacity={0.25} tooltipType="none" isAnimationActive={false} legendType="none" />}
            {showRaw && <Line type="monotone" dataKey="raw" name="Raw splice" stroke={RAW} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={false} />}
            {showHarm && <Line type="monotone" dataKey="harmonized" name="Harmonized" stroke={HARM} strokeWidth={2} dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="legend-row">
        {showRaw && <span><i className="swatch dashed" style={{ borderColor: RAW }} /> Raw splice (no adjustment)</span>}
        {showHarm && <span><i className="swatch" style={{ background: HARM }} /> Harmonized, with the 10 to 90 percent range of the estimated months (before the dashed line)</span>}
      </p>
      {text && <p>{text}</p>}
    </div>
  );
}
