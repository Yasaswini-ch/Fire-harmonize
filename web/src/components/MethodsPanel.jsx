// Every figure shown here is read from /data/meta.json (passed in as `meta`). The explanation below is
// fixed prose with no numbers in it. A missing field shows "not in meta.json", never a guess.
const MISSING = "not in meta.json";
const pct = (x) => (Number.isFinite(x) ? `${x >= 0 ? "" : "-"}${Math.abs(x).toFixed(1)}%` : MISSING);
const CONF = { l: "low", n: "nominal", h: "high" };

const ratio = (x) => (Number.isFinite(x) ? x.toFixed(3) : MISSING);
const n1 = (x) => (Number.isFinite(x) ? `${x.toFixed(1)}%` : MISSING);
const n2 = (x) => (Number.isFinite(x) ? `${x.toFixed(2)}%` : MISSING);
const count = (x) => (Number.isFinite(x) ? Math.round(x).toLocaleString("en-US") : MISSING);
const pctPlain = (x) => (Number.isFinite(x) ? `${Math.round(x)}%` : MISSING);

// Error and interval coverage by the size of the area, and one sentence comparing the whole region with the
// smallest areas measured. All numbers come from meta.json. Both error measures are shown: the median percent
// error is dominated by months with few detections, the count-weighted error is not.
function SizeTable({ classes }) {
  const whole = classes.find((c) => c.id === "region");
  const sized = classes.filter((c) => c.id !== "region").sort((a, b) => a.minDeg - b.minDeg);
  const small = sized[0];
  const both = Number.isFinite(whole?.medianApePct) && Number.isFinite(small?.medianApePct);
  return (
    <>
      <h3>Error by area size</h3>
      <div className="table-scroll">
        <table className="size-table">
          <thead>
            <tr>
              <th>Area (longer side)</th><th>Sample areas</th><th>Median error</th><th>Bias</th>
              <th>Count-weighted error</th><th>Median monthly count</th><th>Months estimated as 0</th><th>Interval hit rate</th>
            </tr>
          </thead>
          <tbody>
            {[...sized, ...(whole ? [whole] : [])].map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td><td>{c.nAois}</td><td>{pct(c.medianApePct)}</td><td>{pct(c.biasPct)}</td>
                <td>{pct(c.countWeightedErrorPct)}</td><td>{count(c.medianActualCountNonzero)}</td>
                <td>{pctPlain(c.coverage?.zeroPredSharePct)}</td><td>{pctPlain(c.coverage?.heldOutYearsPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {both && (
        <p>
          Region-wide, an estimated month is typically off by {pct(whole.medianApePct)}; for areas of {small.minDeg} to {small.maxDeg} degrees
          it is {pct(small.medianApePct)}.{whole.medianApePct < small.medianApePct ? " Small areas are less certain than the region as a whole." : ""}
        </p>
      )}
      <p className="hint">
        Same sample areas and held-out predictions for every row. Median error counts only months with detections, so it is
        pushed up by months with few of them; count-weighted error is the total error divided by the total detections, so it is not.
        Interval hit rate is the share of months inside the stated range, measured on years left out when the range was set; the target
        is {pctPlain(classes[0]?.coverage?.targetPct)}. "Months estimated as 0" is the share of months with real detections in which the model
        estimated none; a range scaled from 0 would stay at 0, so those months get a range from 0 up to the level seen in such months.
        Areas smaller than the smallest size sampled were not measured.
      </p>
    </>
  );
}

// estimatedRange: [first, last] month of the MODIS-estimated part of the series. meta.json does not hold it,
// so the caller reads it from the loaded cells_{region}.json (null while that file is loading).
// bare: render the content without its own collapsible wrapper (used inside the Accuracy and methods section).
export default function MethodsPanel({ meta, regionId, regionName, estimatedRange = null, bare = false }) {
  const m = meta.regions?.[regionId];
  const aoi = m?.cv?.chosen?.aoi;
  const f = meta.filters ?? {};
  const bridge = m?.bridgeNoaa20ToSnpp;
  const fit = m?.model?.fitWindow ? `${m.model.fitWindow[0]} to ${m.model.fitWindow[1]}` : MISSING;
  const overlap = Array.isArray(bridge?.overlap) ? `${bridge.overlap[0]} to ${bridge.overlap[1]}` : (bridge?.overlap ?? MISSING);
  const mask = m?.staticMask;
  const maskTest = meta.staticMaskValidation?.regions?.[regionId]?.exact; // measured by pipeline/05_validate_mask.py
  const content = (
    <>

      <h3>Model and validation for {regionName}</h3>
      {!m ? <p className="field-error">No entry for {regionId} in meta.json.</p> : (
        <dl className="summary">
          <dt>Chosen model</dt><dd>{m.model?.name ?? MISSING}</dd>
          <dt>Fitted on months</dt><dd>{m.model?.fitWindow ? `${m.model.fitWindow[0]} to ${m.model.fitWindow[1]}` : MISSING}</dd>
          <dt>Held-out years (cross-validation)</dt><dd>{m.model?.cvFolds ?? MISSING}</dd>
          <dt>AOI-level median error</dt><dd>{pct(aoi?.median_ape_pct)}</dd>
          <dt>AOI-level bias</dt><dd>{pct(aoi?.bias_pct)}</dd>
        </dl>
      )}
      {m?.cv?.interval && <p className="hint">Range: {m.cv.interval}.</p>}

      {m?.modelSelection && (
        <>
          <h3>How the model was chosen</h3>
          <p>{m.modelSelection.rule}</p>
          <div className="table-scroll">
            <table className="size-table">
              <thead><tr><th>Model</th><th>Median error</th><th>Bias</th><th>Within bias limit</th></tr></thead>
              <tbody>
                {m.modelSelection.candidates.map((c) => (
                  <tr key={c.model} className={c.model === m.modelSelection.chosen ? "chosen" : undefined}>
                    <td>{c.model} {c.name}{c.model === m.modelSelection.chosen ? " (used)" : ""}</td>
                    <td>{pct(c.medianApePct)}</td><td>{pct(c.biasPct)}</td><td>{c.qualifies ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.modelSelection.noneQualified && <p className="notice-line" role="alert">No candidate model met the bias limit for this region, so the one with the smallest bias was used.</p>}
          <p className="hint">{m.modelSelection.note}</p>
        </>
      )}

      {m?.sizeClasses?.length > 0 && <SizeTable classes={m.sizeClasses} />}
      {m?.warnings?.length > 0 && (
        <div className="notice-line" role="alert">
          <strong>Validation warnings for this region:</strong>
          <ul>{m.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      <p className="hint">Error and bias are measured on held-out years over many sample areas of the region, not on your drawn area.</p>

      <h3>Limitations</h3>
      <ul className="limits">
        <li>
          The MODIS-to-VIIRS relationship was estimated on {m?.model?.fitWindow ? `${m.model.fitWindow[0]} to ${m.model.fitWindow[1]}` : MISSING} and
          is assumed to hold for earlier years. That cannot be checked.
        </li>
        <li>Counts are detections, not area burned.</li>
        <li>Detections are not unique fires: one fire can produce many detections across pixels and overpasses.</li>
        <li>Values are VIIRS-equivalent, because VIIRS sees smaller fires than MODIS.</li>
        <li>
          Confidence filtering: MODIS detections below confidence {f.modis_min_confidence ?? MISSING} are dropped; VIIRS detections
          of {(f.viirs_dropped_confidence ?? []).map((c) => CONF[c] ?? c).join(", ") || MISSING} confidence are dropped; only
          detections of type {f.type_kept ?? MISSING} (presumed vegetation fire) are kept.
        </li>
        <li>Recent months are provisional: they use near-real-time data and may change when standard processing replaces them.</li>
        <li>The MODIS series uses {(f.modis_platforms_kept ?? []).join(", ") || MISSING} only. {meta.platformNote ?? ""}</li>
        <li>
          Aqua's crossing time has drifted, so MODIS is used only to estimate months from {estimatedRange ? estimatedRange[0] : MISSING} to {estimatedRange ? estimatedRange[1] : MISSING},
          and the MODIS-to-VIIRS relationship was fitted on {fit}. {m?.driftDiagnostic?.note ?? ""}
        </li>
        <li>
          Suomi NPP: {meta.snpp?.note ?? MISSING}. The series uses Suomi NPP data through {meta.snpp?.lastDateUsedInSeries ?? MISSING}; later months come from NOAA-20.
          {" "}{bridge ? (
            <>
              Bridge, NOAA-20 against Suomi NPP over {overlap}: median ratio {ratio(bridge.aoiMedianRatio)} for this area-level check
              (regional monthly median {ratio(bridge.regionMonthlyMedianRatio)}); scaling {bridge.scalingApplied ? `applied (factor ${ratio(bridge.scaleFactor)})` : "not applied"}.
              {Array.isArray(bridge.recentMonths) && Number.isFinite(bridge.recentRatioMedian) && (
                <>
                  {" "}Over the latest months ({bridge.recentMonths[0]} to {bridge.recentMonths[1]}) the median ratio is {ratio(bridge.recentRatioMedian)}
                  {bridge.recentOutsideTolerance ? ": outside the range we accept, so recent Suomi NPP months may be low and the handover to NOAA-20 may add a step." : "."}
                </>
              )}
            </>
          ) : `Bridge ratio: ${MISSING} for this region.`}
        </li>
        <li>
          Near-real-time months have no type field, so detections there are filtered with a location mask instead of the type filter.
          The mask comes from {mask?.sp_viirs_type_nonzero_rows ?? MISSING} standard-processing VIIRS detections that were not presumed vegetation
          fires, out of {mask?.sp_viirs_rows ?? MISSING}, matched at {f.static_mask_round_deg ?? MISSING} degrees.
          {maskTest ? (
            <>
              {" "}Tested on NOAA-20 data treated as if it had no type field, the mask removes {n1(maskTest.recall_pct)} of the static sources and
              falsely removes {n2(maskTest.false_drop_pct)} of real vegetation fires. After the mask the monthly count is off by a median of{" "}
              {n1(maskTest.net_monthly_bias_pct?.median)}, and by between {n1(maskTest.net_monthly_bias_pct?.min)} and {n1(maskTest.net_monthly_bias_pct?.max)} in the
              worst months.
            </>
          ) : " The mask has not been validated for this region."}
        </li>
      </ul>

      {meta.methodsSummary && (
        <details className="nested">
          <summary>Full methods text from the pipeline</summary>
          <p>{meta.methodsSummary}</p>
        </details>
      )}
      <p className="hint">Data version {meta.dataVersion ?? MISSING}, generated {meta.generated ?? MISSING}.</p>
    </>
  );
  if (bare) return <div className="methods-body">{content}</div>;
  return (
    <details className="panel methods">
      <summary>Methods and validation</summary>
      {content}
    </details>
  );
}
