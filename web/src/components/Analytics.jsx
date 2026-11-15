import { useMemo, useState } from "react";
import AnomalyChart from "./AnomalyChart.jsx";
import CalendarCard from "./CalendarCard.jsx";
import CurrentMonthCard from "./CurrentMonthCard.jsx";
import FireSeasonCard from "./FireSeasonCard.jsx";
import ResultsPage from "./ResultsPage.jsx";
import SeasonalProfile from "./SeasonalProfile.jsx";
import SeasonShift from "./SeasonShift.jsx";
import StatCard from "./StatCard.jsx";
import { accuracyOf } from "../lib/accuracy.js";
import { falseJumpOf } from "../lib/falseJump.js";
import { rankingOf } from "../lib/ranking.js";
import { seasonShiftOf } from "../lib/seasonShift.js";
import {
  annualTotals, anomalyZ, baselineYearCount, currentMonthComparison, fireSeasonWindow, monthlyMedianBaseline, yearOf,
} from "../lib/stats.js";

// The page body for one area and period. fullSeries: aggregateSeries output for the whole record. rangeRows: the slice in
// the selected date range. The date range drives everything except the baseline, which has its own year selectors and is
// always computed from the full record.
//   left: the area and map column; it sits beside the stat card and the calendar on a wide screen, below them on a narrow one.
//   more: a function that receives { comparison } and returns the collapsed sections.
//   page: "workbench" (the calendar and map) or "results" (the results in words and how the numbers are made).
export default function Analytics({ fullSeries, rangeRows, context, left = null, more = null, meta = null, regionId = null, page = "workbench", onPage = () => {}, onTour = null }) {
  const completeYears = useMemo(() => annualTotals(fullSeries).map((t) => t.year), [fullSeries]);
  const [pick, setPick] = useState(null); // { start, end } once the user changes a dropdown
  // Both re-run the series with the estimated months drawn from their ranges (see lib/uncertainty.js); they follow the selected dates.
  // Each is worked out only on the page that shows it, because the draws take a moment.
  const ranking = useMemo(() => (page === "results" ? rankingOf(rangeRows) : null), [rangeRows, page]);
  const shift = useMemo(() => (page === "results" ? null : seasonShiftOf(rangeRows)), [rangeRows, page]);

  const total = rangeRows.reduce((a, r) => a + r.count, 0);
  if (total === 0) {
    return (
      <div className="workrow">
        <div className="col-right">
          <section className="card" role="status">
            <h2>No detections in this area and period</h2>
            <p>The selected area has zero detections from {rangeRows[0].month} to {rangeRows[rangeRows.length - 1].month}. Try a larger area or a longer period.</p>
          </section>
        </div>
        {left}
      </div>
    );
  }

  const bStart = pick?.start ?? completeYears[0];
  const bEnd = pick?.end ?? completeYears[completeYears.length - 1];
  const excludeYear = yearOf(rangeRows[rangeRows.length - 1].month);
  const baseline = bStart === undefined ? null : monthlyMedianBaseline(fullSeries, bStart, bEnd, excludeYear);
  const nBase = baseline ? baselineYearCount(baseline) : 0;
  const season = baseline ? fireSeasonWindow(fullSeries, bStart, bEnd, excludeYear) : null;
  const comparison = baseline ? currentMonthComparison(rangeRows, baseline) : null;
  const anomaly = baseline && rangeRows.length >= 12 ? anomalyZ(rangeRows, bStart, bEnd, fullSeries) : null;

  if (page === "results") {
    return (
      <ResultsPage regionId={regionId} regionName={context.regionName} rows={rangeRows} comparison={comparison} season={season} anomaly={anomaly}
        accuracy={meta && regionId ? accuracyOf(meta, regionId) : null} jump={meta && regionId ? falseJumpOf(meta, regionId) : null} ranking={ranking}
        onTour={onTour} onBack={() => onPage("workbench")} />
    );
  }

  const baselineControls = baseline === null ? null : (
    <div className="baseline-controls">
      <div className="fields two">
        <label><span>Baseline years from</span>
          <select value={bStart} onChange={(e) => setPick({ start: Number(e.target.value), end: Math.max(Number(e.target.value), bEnd) })}>
            {completeYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label><span>to</span>
          <select value={bEnd} onChange={(e) => setPick({ start: Math.min(Number(e.target.value), bStart), end: Number(e.target.value) })}>
            {completeYears.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>
      <p className="hint">Defaults to the earliest through latest complete year. The year being compared ({excludeYear}) is left out of the monthly baseline.</p>
      {nBase < 5 && (
        <p className="notice-line" role="status">
          Caution: the monthly baseline rests on {nBase} {nBase === 1 ? "year" : "years"}. Medians, percentiles and the fire season are unreliable below 5 years.
        </p>
      )}
    </div>
  );

  return (
    <>
      <div className="workrow">
        <div className="col-right">
          <StatCard rows={rangeRows} comparison={comparison} />
          <CalendarCard rows={rangeRows} baseline={baseline} season={season} recordStart={fullSeries[0].month} context={context} />
        </div>
        {left}
      </div>

      <div className="row3">
        {baseline === null ? (
          <section className="card" aria-label="Baseline">
            <h2>Now vs normal</h2>
            <p className="field-error" role="alert">The record has no complete calendar year, so no baseline can be built.</p>
          </section>
        ) : (
          <>
            <CurrentMonthCard comparison={comparison}>{baselineControls}</CurrentMonthCard>
            <FireSeasonCard season={season} />
            <SeasonalProfile baseline={baseline} rangeRows={rangeRows} context={context} />
          </>
        )}
      </div>

      {baseline && (
        rangeRows.length < 12 ? (
          <section className="card" aria-label="Annual anomalies">
            <h2>Annual anomaly (z-score)</h2>
            <p>Hidden: the selected range is {rangeRows.length} {rangeRows.length === 1 ? "month" : "months"}. Annual anomalies need at least one complete calendar year, so choose 12 or more months.</p>
          </section>
        ) : (
          <AnomalyChart anomaly={anomaly} context={context} baselineText={`${bStart} to ${bEnd}`} />
        )
      )}

      {shift && <SeasonShift shift={shift} />}

      {more && more({ comparison })}
    </>
  );
}
