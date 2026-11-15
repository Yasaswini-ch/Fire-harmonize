import AtAGlance from "./AtAGlance.jsx";
import MethodExplainer from "./MethodExplainer.jsx";

// The second page of the workbench: the results in plain language, how to read each graph, and how the numbers are made.
export default function ResultsPage({ regionName, rows, comparison, season, anomaly, accuracy, onTour, onBack }) {
  return (
    <div className="results-page">
      <section className="card" aria-label="Results and how to read the graphs">
        <div className="card-head">
          <h2>Results and how to read the graphs</h2>
          <button type="button" className="ghost" onClick={onBack}>Back to the calendar</button>
        </div>
        <AtAGlance regionName={regionName} rows={rows} comparison={comparison} season={season} anomaly={anomaly} accuracy={accuracy} onTour={onTour} />
      </section>
      <section className="card" aria-label="How the numbers are made">
        <MethodExplainer />
      </section>
    </div>
  );
}
