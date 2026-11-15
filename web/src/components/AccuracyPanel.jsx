import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { accuracyOf, chartData, TARGET_PCT } from "../lib/accuracy.js";

// "How accurate is this?" Three graphs, all drawn from numbers the pipeline measured and wrote to meta.json:
//   1. the candidate models side by side (why this one was chosen),
//   2. the chosen model's error in every held-out year,
//   3. for the per-calendar-month model, how many VIIRS detections there are per MODIS detection in each month.
// A graph whose numbers are not in meta.json is left out. The text under each graph says the same thing in words.
const AXIS = { stroke: "#aab2c0", tick: { fill: "#e6e1d6", fontSize: 14 } };
const TIP = { contentStyle: { background: "#0c121e", border: "1px solid #3a4a63", color: "#eef2f8" } };
const OK = "#5fd394";
const WARN = "#f5b23a";
const FIRE = "#ff8a3d";
const MODEL_LABEL = { A: "A single ratio", B: "B log-linear", C: "C log-linear + month", D: "D ratio per month", E: "E ratio per month and activity" };

const barFill = (v) => (v <= TARGET_PCT ? OK : WARN);

export default function AccuracyPanel({ meta, regionId, regionName }) {
  const acc = accuracyOf(meta, regionId);
  if (!acc) return null;
  const { models, byYear, afterFit, ratios } = chartData(meta, regionId);
  const worst = byYear.length ? byYear.reduce((a, b) => (b.errorPct > a.errorPct ? b : a)) : null;
  const lo = ratios.length ? ratios.reduce((a, b) => (b.ratio < a.ratio ? b : a)) : null;
  const hi = ratios.length ? ratios.reduce((a, b) => (b.ratio > a.ratio ? b : a)) : null;
  return (
    <section className="panel" aria-label="How accurate is this">
      <div className="panel-head"><h2>How accurate is this?</h2></div>
      <p className={`rcard-acc ${acc.withinTarget ? "ok" : "warn"}`}>
        {regionName}: a MODIS-estimated month is typically off by {Math.round(acc.medianErrorPct)}% (median; bias {acc.biasPct >= 0 ? "+" : ""}{acc.biasPct.toFixed(1)}%),{" "}
        {acc.withinTarget ? `within our ${TARGET_PCT}% target` : `above our ${TARGET_PCT}% target, so treat estimated months as rough`}.
        Measured by leaving each year out in turn on {acc.fitWindow ? `${acc.fitWindow[0]} to ${acc.fitWindow[1]}` : "the overlap years"}, over sample areas of 1 to 5 degrees.
      </p>

      <div className="acc-grid">
      {models.length > 0 && (
        <div className="acc-chart">
          <h3 className="chart-title">Which model fits best (lower is better)</h3>
          <div role="img" aria-label={`Median error by model: ${models.map((m) => `${MODEL_LABEL[m.id] ?? m.id} ${Math.round(m.errorPct)} percent`).join(", ")}. Chosen: ${models.find((m) => m.chosen)?.id ?? "none"}.`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={models.map((m) => ({ ...m, letter: m.id }))} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#2a3548" strokeDasharray="3 3" />
                <XAxis dataKey="letter" {...AXIS} interval={0} />
                <YAxis {...AXIS} width={44} unit="%" />
                <Tooltip {...TIP} formatter={(v) => [`${Math.round(v)}%`, "median error"]} />
                <ReferenceLine y={TARGET_PCT} stroke={WARN} strokeDasharray="6 4" label={{ value: `${TARGET_PCT}% target`, fill: WARN, position: "insideTopRight", fontSize: 14 }} />
                <Bar dataKey="errorPct" isAnimationActive={false}>
                  {models.map((m) => <Cell key={m.id} fill={barFill(m.errorPct)} stroke={m.chosen ? "#eef2f8" : "none"} strokeWidth={2} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="hint">{models.map((m) => MODEL_LABEL[m.id] ?? m.id).join(" · ")}. The model with the white outline is the one used: the pipeline keeps the models whose bias is within the limit, then takes the lowest error.</p>
        </div>
      )}

      {byYear.length > 0 && (
        <div className="acc-chart">
          <h3 className="chart-title">Error in each held-out year</h3>
          <div role="img" aria-label={`Median error in each held-out year, ${byYear[0].year} to ${byYear[byYear.length - 1].year}. Worst: ${worst.year} at ${Math.round(worst.errorPct)} percent.`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={[...byYear.map((d) => ({ ...d, kind: "held out" })), ...afterFit.map((d) => ({ ...d, kind: "after the fit window" }))]} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#2a3548" strokeDasharray="3 3" />
                <XAxis dataKey="year" {...AXIS} />
                <YAxis {...AXIS} width={44} unit="%" />
                <Tooltip {...TIP} formatter={(v, _n, p) => [`${Math.round(v)}% (${p.payload.kind})`, "median error"]} />
                <ReferenceLine y={TARGET_PCT} stroke={WARN} strokeDasharray="6 4" />
                <Bar dataKey="errorPct" isAnimationActive={false}>
                  {[...byYear.map((d) => ({ ...d, after: false })), ...afterFit.map((d) => ({ ...d, after: true }))].map((d) => (
                    <Cell key={d.year} fill={barFill(d.errorPct)} fillOpacity={d.after ? 0.45 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="hint">
            Solid bars are years held out of the fit. {afterFit.length > 0 && "Faded bars (after the fit window) are not held out, and show the effect of Aqua's drifting overpass time; nothing was tuned to them. "}
            Worst held-out year: {worst.year} ({Math.round(worst.errorPct)}%).
          </p>
        </div>
      )}

      {ratios.length > 0 && (
        <div className="acc-chart">
          <h3 className="chart-title">VIIRS detections per MODIS detection, by month</h3>
          <div role="img" aria-label={`Ratio by calendar month. Lowest ${lo.month} ${lo.ratio.toFixed(1)}, highest ${hi.month} ${hi.ratio.toFixed(1)}.`}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ratios} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke="#2a3548" strokeDasharray="3 3" />
                <XAxis dataKey="month" {...AXIS} />
                <YAxis {...AXIS} width={44} />
                <Tooltip {...TIP} formatter={(v) => [v.toFixed(2), "VIIRS per MODIS"]} />
                <Bar dataKey="ratio" fill={FIRE} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="hint">
            In {regionName} VIIRS sees {lo.ratio.toFixed(1)} detections for every MODIS one in {lo.month} and {hi.ratio.toFixed(1)} in {hi.month}.
            One ratio for the whole year would be wrong in most months, which is why this model fits better.
          </p>
        </div>
      )}
      </div>
    </section>
  );
}
