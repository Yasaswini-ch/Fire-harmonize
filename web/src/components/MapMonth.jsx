import { fmt, monthLabel } from "../lib/format.js";
import { cellsAt, monthIndices, monthSource, SOURCE_LABEL } from "../lib/hotspots.js";

// Month picker for the map's detections: a slider over the months of the selected date range, a button that jumps to the
// busiest month, one line saying what is shown, and a small colour legend (the same scale the map uses).
export default function MapMonth({ data, from, to, index, peakIndex, max, onPick }) {
  const idx = monthIndices(data, from, to);
  if (idx.length === 0 || index === null) return null;
  const pos = Math.max(0, idx.indexOf(index));
  const shown = cellsAt(data, index);
  return (
    <div className="map-month" aria-label="Detections on the map" role="group">
      <div className="map-month-row">
        <label className="grow"><span>Detections for {monthLabel(data.months[index])}</span>
          <input type="range" min={0} max={idx.length - 1} value={pos} onChange={(e) => onPick(idx[Number(e.target.value)])} />
        </label>
        <button type="button" className="ghost" disabled={peakIndex === null || index === peakIndex} onClick={() => onPick(peakIndex)}>Busiest</button>
      </div>
      <p className="hint">{fmt(shown.length)} cells with detections · {SOURCE_LABEL[monthSource(data, index)]}</p>
      <div className="legend-scale" aria-hidden="true">
        <span>1</span><i className="ramp inferno" /><span>{fmt(max)}+ per 0.25° cell</span>
      </div>
    </div>
  );
}
