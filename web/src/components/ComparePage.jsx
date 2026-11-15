import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { aggregateSeries } from "../lib/aggregate.js";
import { aoiFields, clipAoi, regionAoi, validateBboxInput } from "../lib/aoi.js";
import { anomalyPairs, correlationText, sameYears, summarizeArea } from "../lib/compare.js";
import { describeAoi } from "../lib/describe.js";
import { fmt, fmtPct, MONTH_NAMES, MONTHS, monthLabel } from "../lib/format.js";

const A_COLOR = "#f0b84a";
const B_COLOR = "#57e3ff";
const TICK = { fill: "#e6e1d6", fontSize: 14 };
const TIP = { background: "#151820", border: "1px solid #3a4150", color: "#f4efe5", fontSize: 14 };
const FIELDS = [["maxLat", "North"], ["minLat", "South"], ["minLon", "West"], ["maxLon", "East"]];

const seasonText = (s) => (s ? `${MONTH_NAMES[s.months[0] - 1]} to ${MONTH_NAMES[s.months[s.length - 1] - 1]} (${s.length} ${s.length === 1 ? "month" : "months"})` : "none");
const nowText = (c) => (!c || c.label === null ? "n/a" : `${monthLabel(c.month)}: ${c.percentDiff === null ? c.label : `${fmtPct(c.percentDiff)} against the median`}${c.provisional ? " (provisional)" : ""}`);

// Compare the area on the Calendar and map tab (Area A) with a second area inside the same region (Area B).
export default function ComparePage({ region, cellsData, aoiA, start, end }) {
  const [fields, setFields] = useState(() => aoiFields(regionAoi(region)));
  const [aoiB, setAoiB] = useState(() => regionAoi(region));
  const check = validateBboxInput(fields);
  const clippedB = useMemo(() => clipAoi(aoiB, region.bbox), [aoiB, region]);

  const sumA = useMemo(() => summarizeArea(aggregateSeries(cellsData, aoiA), start, end), [cellsData, aoiA, start, end]);
  const sumB = useMemo(() => (clippedB ? summarizeArea(aggregateSeries(cellsData, clippedB.aoi), start, end) : null), [cellsData, clippedB, start, end]);

  const same = sumA && sumB ? sameYears(sumA, sumB) : null;
  const pairs = sumA && sumB ? anomalyPairs(sumA, sumB) : [];
  const seasonData = sumA?.seasonShare && sumB?.seasonShare
    ? MONTHS.map((m, i) => ({ month: m, a: +sumA.seasonShare[i].toFixed(1), b: +sumB.seasonShare[i].toFixed(1) })) : [];
  const flagged = (s) => (s.anomaly?.years ?? []).filter((y) => y.flag).map((y) => `${y.year} (${y.z > 0 ? "+" : ""}${y.z.toFixed(1)})`).join(", ") || "none";
  const withRange = (s) => `${fmt(s.total)}${s.estimatedMonths > 0 ? ` (range ${fmt(s.lo)} to ${fmt(s.hi)})` : ""}`;
  const peak = (s) => (s.peak ? `${monthLabel(s.peak.month)} (${fmt(s.peak.count)})` : "none");

  const rowsOut = sumA && sumB ? [
    ["Area", describeAoi(aoiA), describeAoi(clippedB.aoi)],
    ["Detections in range", withRange(sumA), withRange(sumB)],
    ["Peak month", peak(sumA), peak(sumB)],
    ["Estimated months", `${sumA.estimatedMonths} of ${sumA.rows.length}`, `${sumB.estimatedMonths} of ${sumB.rows.length}`],
    ["Fire season", seasonText(sumA.season), seasonText(sumB.season)],
    ["Latest month vs normal", nowText(sumA.comparison), nowText(sumB.comparison)],
    ["Unusual years (beyond 2 SD)", flagged(sumA), flagged(sumB)],
  ] : [];

  return (
    <div className="compare-page">
      <section className="card" aria-label="Choose the two areas">
        <h2>Compare two areas</h2>
        <p className="hint">Both areas use the date range chosen on the Calendar and map tab, and must lie inside {region.name}.</p>
        <div className="compare-pick">
          <div>
            <h3><i className="dot a" /> Area A</h3>
            <p>{describeAoi(aoiA)}</p>
            <p className="hint">This is the area on the Calendar and map tab. Change it there.</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (check.ok) setAoiB(check.aoi); }} noValidate>
            <h3><i className="dot b" /> Area B</h3>
            <div className="fields coords-fields">
              {FIELDS.map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input value={fields[key]} inputMode="decimal" aria-invalid={Boolean(check.errors[key])}
                    onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
                  {check.errors[key] && <span className="field-error" role="alert">{check.errors[key]}</span>}
                </label>
              ))}
            </div>
            <div className="btn-row">
              <button type="submit" disabled={!check.ok}>Compare</button>
              <button type="button" className="ghost" onClick={() => { const full = regionAoi(region); setFields(aoiFields(full)); setAoiB(full); }}>Use the full region</button>
            </div>
          </form>
        </div>
      </section>

      {!clippedB && <p className="notice error field-error" role="alert">Area B does not overlap {region.name}.</p>}
      {clippedB?.wasClipped && <p className="notice warn" role="status">Area B reaches outside {region.name}; only the overlap is used.</p>}
      {sumA && sumB && JSON.stringify(aoiA) === JSON.stringify(clippedB.aoi) && (
        <p className="notice warn" role="status">Both areas are the same, so every figure is identical. Enter a different Area B.</p>
      )}
      {(!sumA || (clippedB && !sumB)) && <p className="notice error field-error" role="alert">No data in the selected date range for one of the areas.</p>}

      {sumA && sumB && (
        <>
          <section className="card" aria-label="Side by side">
            <h2>Side by side</h2>
            <div className="table-scroll">
              <table className="size-table compare-table">
                <thead><tr><th></th><th><i className="dot a" /> Area A</th><th><i className="dot b" /> Area B</th></tr></thead>
                <tbody>{rowsOut.map(([k, a, b]) => <tr key={k}><th scope="row">{k}</th><td>{a}</td><td>{b}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="hint">VIIRS-equivalent detections. Harmonized values are model estimates, not observations. Ranges add up the monthly ranges of estimated months, so they are wide on purpose.</p>
            <p>{correlationText(same.correlation, same.years, sumA.estimatedMonths > 0 && sumB.estimatedMonths > 0)}</p>
          </section>

          <section className="card" aria-label="Seasonal shape">
            <h2>Seasonal shape</h2>
            <p className="hint">Each calendar month as a share of the area's typical annual total, in percent, so areas of different size can be compared.</p>
            {seasonData.length === 0 ? <p>No baseline year has detections, so no seasonal shape is available.</p> : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={seasonData} margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#262b36" vertical={false} />
                  <XAxis dataKey="month" stroke="#aab2c0" tick={TICK} />
                  <YAxis stroke="#aab2c0" tick={TICK} width={48} unit="%" />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} contentStyle={TIP} formatter={(v) => `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 14 }} />
                  <Bar dataKey="a" name="Area A" fill={A_COLOR} isAnimationActive={false} />
                  <Bar dataKey="b" name="Area B" fill={B_COLOR} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>

          <section className="card" aria-label="Annual anomaly, both areas">
            <h2>Annual anomaly, both areas</h2>
            <p className="hint">How far each complete year is from that area's own baseline, in standard deviations. Bars that rise and fall together mean the areas burn in the same years.</p>
            {pairs.length === 0 ? <p>Needs a date range of 12 months or more with a baseline.</p> : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pairs} margin={{ top: 12, right: 24, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="#262b36" vertical={false} />
                  <XAxis dataKey="year" stroke="#aab2c0" tick={TICK} interval={3} />
                  <YAxis stroke="#aab2c0" tick={TICK} width={44} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.06)" }} contentStyle={TIP} formatter={(v) => v.toFixed(2)} />
                  <Legend wrapperStyle={{ fontSize: 14 }} />
                  <Bar dataKey="a" name="Area A" fill={A_COLOR} isAnimationActive={false} />
                  <Bar dataKey="b" name="Area B" fill={B_COLOR} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </section>
        </>
      )}
    </div>
  );
}
