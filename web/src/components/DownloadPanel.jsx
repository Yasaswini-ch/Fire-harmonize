import { useMemo, useState } from "react";
import { CELL_ROW_CAP, cellExportPlan, cellsCsv, cellsFileName, monthlyCsv, monthlyFileName } from "../lib/csv.js";
import { downloadText } from "../lib/download.js";

const n = (x) => x.toLocaleString("en-US");

// Two CSV exports for the current AOI and date range. rangeRows is the monthly series already cut to the range.
export default function DownloadPanel({ region, aoi, start, end, rangeRows, cellsData }) {
  const plan = useMemo(() => cellExportPlan(cellsData, aoi, start, end), [cellsData, aoi, start, end]);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState(null);

  function monthly() {
    const name = monthlyFileName(region.id, aoi, start, end);
    downloadText(monthlyCsv(rangeRows, region.name, aoi, new Date().toISOString()), name);
    setStatus(`Downloaded ${name} (${n(rangeRows.length)} rows).`);
  }

  function cells(maxRows) {
    const out = cellsCsv(cellsData, plan, maxRows);
    const name = cellsFileName(region.id, aoi, start, end, out.capped);
    downloadText(out.text, name);
    setConfirming(false);
    setStatus(out.capped
      ? `Capped: ${name} holds ${n(out.cellsWritten)} of ${n(plan.cells.length)} cells (${n(out.rows)} of ${n(plan.totalRows)} rows). The limit is ${n(CELL_ROW_CAP)} rows.`
      : `Downloaded ${name} (${n(out.rows)} rows).`);
  }

  const tooBig = plan.totalRows > CELL_ROW_CAP;
  return (
    <section className="panel" aria-label="Downloads">
      <h2>Download data</h2>
      <div className="button-row">
        <button type="button" onClick={monthly}>Download harmonized monthly counts (CSV)</button>
        <button type="button" disabled={plan.totalRows === 0} onClick={() => (tooBig ? setConfirming(true) : cells(Infinity))}>
          Download gridded cell counts (CSV)
        </button>
      </div>
      <p className="hint">
        Monthly file: {n(rangeRows.length)} rows for the area and range shown, with lower and upper bounds and a source flag.
        Cell file: {n(plan.totalRows)} rows ({n(plan.cells.length)} grid cells, stored values, not area-weighted; no interval columns, use the monthly file for intervals).
      </p>
      {plan.totalRows === 0 && <p className="notice-line">No grid cells with data in this area, so there is no cell file to download.</p>}
      {tooBig && !confirming && <p className="notice-line">The cell file is over {n(CELL_ROW_CAP)} rows, so you will be asked to confirm or cap it.</p>}
      {confirming && (
        <div className="notice-line" role="alertdialog" aria-label="Large export">
          <p>This cell file would have {n(plan.totalRows)} rows, more than {n(CELL_ROW_CAP)}. Large files can be slow to open. Download everything, or cap it at {n(CELL_ROW_CAP)} rows (whole cells only, the first {n(Math.floor(CELL_ROW_CAP / plan.monthIdx.length))} of {n(plan.cells.length)}).</p>
          <div className="button-row">
            <button type="button" onClick={() => cells(Infinity)}>Download all {n(plan.totalRows)} rows</button>
            <button type="button" onClick={() => cells(CELL_ROW_CAP)}>Download capped file</button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {status && <p className="status" role="status">{status}</p>}
      <p className="hint">Files are UTF-8 with a byte order mark so Excel opens them correctly. Harmonized values are model estimates, not observations.</p>
    </section>
  );
}
