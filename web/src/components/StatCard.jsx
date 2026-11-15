import { fmt, fmtPct, MONTH_NAMES, monthLabel } from "../lib/format.js";
import { topMonths, topYears } from "../lib/stats.js";

// The headline numbers in one row of five. The first, in the accent colour, answers the question responders ask first:
// is the latest month high or low for this time of year? Everything here is computed from the rows on screen.
// comparison: currentMonthComparison output, or null when no baseline can be built.
export default function StatCard({ rows, comparison }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const peakMonth = topMonths(rows, 1)[0];
  const peakYear = topYears(rows, 1)[0];
  const estimated = rows.filter((r) => r.source === "modis_estimated").length;
  const c = comparison;
  const calMonth = c ? MONTH_NAMES[Number(c.month.slice(5, 7)) - 1] : null;

  let nowValue = "n/a";
  let nowNote = "No baseline years, so the latest month cannot be compared.";
  if (c && c.label !== null) {
    nowValue = c.percentDiff === null ? c.label : fmtPct(c.percentDiff);
    nowNote = c.percentDiff === null
      ? `${monthLabel(c.month)}: the ${calMonth} median is 0`
      : `${monthLabel(c.month)} against the median for ${calMonth}`;
  }

  return (
    <section className="card stat-card" aria-label="Summary">
      <dl className="stat-row">
        <div className="stat stat-now">
          <dt>Now vs normal</dt>
          <dd>{nowValue}</dd>
          <p>{nowNote}{c?.provisional ? " · provisional" : ""}</p>
        </div>
        <div className="stat">
          <dt>Detections in range</dt>
          <dd>{fmt(total)}</dd>
          <p>{rows.length} months</p>
        </div>
        <div className="stat">
          <dt>Peak month</dt>
          <dd>{peakMonth ? monthLabel(peakMonth.month) : "none"}</dd>
          <p>{peakMonth ? `${fmt(peakMonth.count)} detections` : ""}</p>
        </div>
        <div className="stat">
          <dt>Peak year</dt>
          <dd>{peakYear ? peakYear.year : "n/a"}</dd>
          <p>{peakYear ? `${fmt(peakYear.total)} detections` : "needs a full calendar year"}</p>
        </div>
        <div className="stat">
          <dt>Estimated share</dt>
          <dd>{Math.round((100 * estimated) / rows.length)}%</dd>
          <p>{estimated} of {rows.length} months</p>
        </div>
      </dl>
      <p className="hint">VIIRS-equivalent detections. Harmonized values are model estimates, not observations.</p>
    </section>
  );
}
