import { fmt, fmtPct, MONTH_NAMES, monthLabel } from "../lib/format.js";

// "Now vs normal": the latest month against the median of the same calendar month in the baseline years. `children` is
// where the baseline-year selectors go, so the control sits next to the number it changes.
export default function CurrentMonthCard({ comparison: c, children }) {
  if (!c) return null;
  const calMonth = MONTH_NAMES[Number(c.month.slice(5, 7)) - 1];
  return (
    <section className="card" aria-label="Latest month against baseline">
      <h2>Now vs normal</h2>
      <p className="hint">Latest month: {monthLabel(c.month)}</p>
      {c.label === null ? (
        <p>No baseline years have data for {calMonth}, so this month cannot be compared.</p>
      ) : (
        <>
          <p className="big">
            <span className="tag">{c.label.toUpperCase()}</span> baseline
            {c.percentDiff !== null && <> ({fmtPct(c.percentDiff)})</>}
          </p>
          <p>
            {c.yearsBelow === 0 ? `Lower than every one of the ${c.baselineYears} baseline ${calMonth}s.`
              : c.yearsBelow === c.baselineYears ? `Higher than every one of the ${c.baselineYears} baseline ${calMonth}s.`
              : `Higher than ${c.yearsBelow} of the ${c.baselineYears} baseline ${calMonth}s.`}
          </p>
          <dl className="summary">
            <dt>Detections</dt><dd>{fmt(c.count)}</dd>
            {c.source === "modis_estimated" && <><dt>Estimated range</dt><dd>{fmt(c.lo)} to {fmt(c.hi)}</dd></>}
            <dt>Baseline median for {calMonth}</dt><dd>{fmt(c.baselineMedian)}</dd>
            <dt>Difference from median</dt>
            <dd>{c.percentDiff === null ? "undefined (median is 0)" : fmtPct(c.percentDiff)}
              {c.source === "modis_estimated" && c.percentDiffLo !== null && ` (${fmtPct(c.percentDiffLo)} to ${fmtPct(c.percentDiffHi)})`}</dd>
            <dt>Percentile among {c.baselineYears} baseline years</dt><dd>{Math.round(c.percentile)}</dd>
          </dl>
        </>
      )}
      {c.provisional && <p className="notice-line">The latest month is provisional: its data may still change and can be incomplete.</p>}
      {c.source === "modis_estimated" && <p className="notice-line">Estimated: this month is a model estimate from MODIS, not a VIIRS observation.</p>}
      {children}
    </section>
  );
}
