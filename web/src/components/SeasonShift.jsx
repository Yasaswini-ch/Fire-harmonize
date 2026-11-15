import { Area, CartesianGrid, ComposedChart, ErrorBar, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dayLabel, dayTicks, SEASON_NOTE, seasonChartData, seasonShiftText } from "../lib/seasonShift.js";

const BAND = "#f0b84a"; // the app's amber accent
const MID = "#56b4e9"; // colour-blind-safe sky blue
const TICK = { fill: "#e6e1d6", fontSize: 14 };

// Is the burning season shifting? The band is each complete year's start to end (10 to 90 percent of its detections) and the dot is
// its middle. Hollow dots are years estimated from MODIS, with their range; the dashed line is the trend over the observed years only.
// The parent passes the result of seasonShiftOf for the selected range; the card explains itself when there is too little to draw.
export default function SeasonShift({ shift }) {
  const text = seasonShiftText(shift);
  const data = seasonChartData(shift);
  const hasChart = data.length >= 2;
  const lo = hasChart ? Math.min(...data.map((d) => Math.min(d.start, d.mid + 0 - d.midErr[0]))) : 0;
  const hi = hasChart ? Math.max(...data.map((d) => Math.max(d.end, d.mid + d.midErr[1]))) : 0;
  const domain = [Math.max(0, Math.floor((lo - 10) / 10) * 10), Math.min(365, Math.ceil((hi + 10) / 10) * 10)];
  const ticks = dayTicks(domain[0], domain[1]);
  return (
    <section className="card" aria-label="Is the fire season shifting?">
      <h2>Is the fire season shifting?</h2>
      <p className="hint">For each complete year in the range, the band runs from the day 10% of that year's detections had happened to the day 90% had, and the dot marks the day half had.</p>
      {!hasChart && <p>The selected range has fewer than two complete calendar years with enough detections, so there is nothing to compare. Choose a longer range.</p>}
      {hasChart && (
        <>
          <div role="img" aria-label={text ?? "Burning season start, middle and end by year"}>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={data} margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#262b36" vertical={false} />
                <XAxis dataKey="year" stroke="#aab2c0" tick={TICK} interval={3} />
                <YAxis type="number" domain={domain} ticks={ticks.map((t) => t.day)} tickFormatter={(d) => ticks.find((t) => t.day === d)?.label ?? ""} stroke="#aab2c0" tick={TICK} width={48} reversed={false} />
                <Tooltip cursor={{ stroke: "#aab2c0" }} contentStyle={{ background: "#151820", border: "1px solid #3a4150", color: "#f4efe5", fontSize: 14 }}
                  labelFormatter={(y) => String(y)}
                  formatter={(v, name, p) => (Array.isArray(v) ? [`${dayLabel(v[0])} to ${dayLabel(v[1])}`, "Season (10% to 90%)"] : [`${dayLabel(v)}${name === "Middle" && p.payload.estimated ? " (estimated)" : ""}`, name])} />
                <Area type="linear" dataKey={(d) => [d.start, d.end]} name="Season" stroke="none" fill={BAND} fillOpacity={0.22} isAnimationActive={false} />
                <Line type="linear" dataKey="trend" name="Trend, observed years" stroke="#e6e1d6" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} />
                <Line type="linear" dataKey="mid" name="Middle" stroke={MID} strokeWidth={1.5} isAnimationActive={false}
                  dot={({ cx, cy, payload, index }) => (
                    <circle key={index} cx={cx} cy={cy} r={5} stroke={MID} strokeWidth={2} fill={payload.estimated ? "#0e1014" : MID} />
                  )}>
                  <ErrorBar dataKey="midErr" width={6} stroke={MID} strokeWidth={2} />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="legend-row">
            <span><i className="swatch" style={{ background: BAND, opacity: 0.5 }} /> Season, 10% to 90% of detections</span>
            <span><i className="swatch" style={{ background: MID }} /> Middle: solid = observed by VIIRS, hollow with bars = estimated, with range</span>
            <span><i className="swatch dashed" style={{ borderColor: "#e6e1d6" }} /> Trend over observed years only</span>
          </p>
          {text && <p>{text}</p>}
          <p className="hint">{SEASON_NOTE}</p>
        </>
      )}
    </section>
  );
}
