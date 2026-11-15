import { lazy, Suspense, useRef, useState } from "react";
import CopyLinkButton from "./CopyLinkButton.jsx";
import { aoiSummary } from "../lib/aoiSummary.js";
import AoiForm from "./AoiForm.jsx";
import DateRange from "./DateRange.jsx";
import MapMonth from "./MapMonth.jsx";
import MapView from "./MapView.jsx";

const GlobeView = lazy(() => import("./GlobeView.jsx")); // three.js loads only when the globe tab is opened

// The left column: a card for the area and the dates, and a card with the map. The map card has two views of the same
// detections, a flat map (where you draw) and a 3D globe, switched with the tabs at its top.
export default function LeftColumn({
  regions, region, state, rangeMsg, onRange, onFullRegion, activeAoi, fit, onAoi, onApplyAoi, hotspots, peakIndex, onMonth, onPickRegion,
}) {
  const drawApi = useRef(null);
  const [view, setView] = useState("map");

  // The drawing tools live on the flat map. From the globe, switch to the map first, then start the tool once it exists.
  const draw = (tool) => {
    if (view !== "map") {
      setView("map");
      setTimeout(() => drawApi.current?.[tool](), 120);
    } else {
      drawApi.current?.[tool]();
    }
  };

  return (
    <div className="col-left">
      <section className="card" aria-label="Area and dates">
        <h2>Area and dates</h2>
        {region && <DateRange region={region} start={state.start} end={state.end} error={rangeMsg} onChange={onRange} />}
        <div className="btn-row">
          <button type="button" className="ghost" onClick={() => draw("rectangle")}>Draw rectangle</button>
          <button type="button" className="ghost" onClick={() => draw("polygon")}>Draw polygon</button>
          <button type="button" className="ghost" onClick={onFullRegion} disabled={!region}>Full region</button>
          <CopyLinkButton />
        </div>
        <p className="hint">{aoiSummary(state.aoi)}</p>
        <AoiForm key={JSON.stringify(state.aoi)} aoi={state.aoi} onApply={onApplyAoi} />
      </section>

      <section className="card" aria-label="Map">
        <div className="view-tabs" role="tablist" aria-label="Map or 3D globe">
          <button type="button" role="tab" aria-selected={view === "map"} onClick={() => setView("map")}>Map</button>
          <button type="button" role="tab" aria-selected={view === "globe"} onClick={() => setView("globe")}>3D globe</button>
        </div>
        {view === "map" ? (
          <>
            <MapView regions={regions} region={region} aoi={state.aoi} activeAoi={activeAoi} fit={fit} onAoi={onAoi} drawApi={drawApi} hotspots={hotspots} />
            {hotspots && region && (
              <MapMonth data={hotspots.data} from={state.start} to={state.end} index={hotspots.index} peakIndex={peakIndex} max={hotspots.max} onPick={onMonth} />
            )}
          </>
        ) : (
          <Suspense fallback={<p className="status" role="status">Loading globe…</p>}>
            <GlobeView regions={regions} cellsData={hotspots?.data ?? null} activeRegion={region} onPick={onPickRegion} />
          </Suspense>
        )}
      </section>
    </div>
  );
}
