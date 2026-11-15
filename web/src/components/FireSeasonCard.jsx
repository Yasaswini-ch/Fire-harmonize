import { MONTH_NAMES } from "../lib/format.js";

export default function FireSeasonCard({ season }) {
  return (
    <section className="card" aria-label="Fire season">
      <h2>Fire season</h2>
      {!season ? (
        <p>The baseline has no detections, so no fire season can be defined.</p>
      ) : (
        <>
          <p className="big">
            {MONTH_NAMES[season.months[0] - 1]}
            {season.length > 1 && <> to {MONTH_NAMES[season.months[season.length - 1] - 1]}</>}
            {" "}({season.length} {season.length === 1 ? "month" : "months"})
          </p>
          <dl className="summary">
            <dt>Share of the typical annual total</dt><dd>{Math.round(season.share * 100)}%</dd>
            <dt>Peak month</dt><dd>{MONTH_NAMES[season.peakMonth - 1]}</dd>
          </dl>
          <p className="hint">The shortest run of consecutive months holding at least 80% of the baseline median profile.</p>
        </>
      )}
    </section>
  );
}
