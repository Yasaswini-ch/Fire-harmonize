import { buildFindings, READING_GUIDE } from "../lib/findings.js";

// The plain-language results: what was done, what it shows for this area, and how to read each graph. It lives in its own
// collapsible section under the charts (MoreSections), so the page opens on the numbers and the calendar. All numbers come
// from lib/findings.js, which reads them from the rows on screen and from meta.json.
export default function AtAGlance({ regionName, rows, comparison, season, anomaly, accuracy, onTour }) {
  const { did, shows } = buildFindings({ rows, comparison, season, anomaly, accuracy });
  return (
    <section className="glance" aria-label="Results at a glance">
      <div className="glance-grid">
        <div>
          <h3>What we did</h3>
          <ul className="glance-list">{did.map((s) => <li key={s}>{s}</li>)}</ul>
        </div>
        <div>
          <h3>What it shows for {regionName}</h3>
          <dl className="glance-shows">
            {shows.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.text}</dd></div>)}
          </dl>
        </div>
      </div>
      <h3>How to read the graphs</h3>
      <div className="guide">
        {READING_GUIDE.map((g) => <div key={g.id}><h4>{g.title}</h4><p>{g.text}</p></div>)}
      </div>
      {onTour && <div className="btn-row"><button type="button" className="ghost" onClick={onTour}>Take the walkthrough</button></div>}
    </section>
  );
}
