import AtAGlance from "./AtAGlance.jsx";
import FalseJump from "./FalseJump.jsx";
import Figures from "./Figures.jsx";
import MethodExplainer from "./MethodExplainer.jsx";

// The second page of the workbench: the results in plain language, how to read each graph, the false jump the harmonizing
// removes, how the numbers are made, and the pictures of how the model was trained and tested.
export default function ResultsPage({ regionId, regionName, rows, comparison, season, anomaly, accuracy, jump = null, ranking = null, onTour, onBack }) {
  return (
    <div className="results-page">
      <section className="card" aria-label="Results and how to read the graphs">
        <div className="card-head">
          <h2>Results and how to read the graphs</h2>
          <button type="button" className="ghost" onClick={onBack}>Back to the calendar</button>
        </div>
        <AtAGlance regionName={regionName} rows={rows} comparison={comparison} season={season} anomaly={anomaly} accuracy={accuracy} ranking={ranking} onTour={onTour} />
      </section>
      {jump && (
        <section className="card" aria-label="The false jump and how harmonizing removes it">
          <FalseJump jump={jump} regionName={regionName} />
        </section>
      )}
      <section className="card" aria-label="How the numbers are made">
        <MethodExplainer />
      </section>
      <section className="card" aria-label="How it was trained and tested">
        <Figures regionId={regionId} regionName={regionName} />
      </section>
    </div>
  );
}
