import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import Analytics from "./components/Analytics.jsx";
import { ExportProvider } from "./components/ExportRegistry.jsx";
import LeftColumn from "./components/LeftColumn.jsx";
import MoreSections from "./components/MoreSections.jsx";
import PageHeader from "./components/PageHeader.jsx";
import { OfflineBanner } from "./components/OfflineControls.jsx";
import Landing from "./components/Landing.jsx";
import Footer from "./components/Footer.jsx";
import NoCoverage from "./components/NoCoverage.jsx";
import SyntheticBanner from "./components/SyntheticBanner.jsx";
import Tour from "./components/Tour.jsx";
import { peakMonthIndex, rampMax } from "./lib/hotspots.js";
import { smallAreaNotice } from "./lib/sizeClass.js";
import { isSynthetic } from "./lib/synthetic.js";
import { aggregateSeries, aoiBounds, gridCellsCovered } from "./lib/aggregate.js";
import { rangeError, regionAoi, regionsForAoi } from "./lib/aoi.js";
import { loadCells, loadMeta, loadRegions } from "./lib/data.js";
import { aoiSlug, describeAoi } from "./lib/describe.js";
import { formatHash, stateFromHash } from "./lib/hash.js";

// Single source of truth for the selection. The map, the numeric form and the presets all read and
// write `aoi`, so they stay in sync.
function reducer(state, action) {
  switch (action.type) {
    case "preset": // full-region AOI and the region's whole date range
    case "region": // the AOI moved into another region; keep the AOI, reset the range
      return {
        regionId: action.region.id,
        aoi: action.type === "preset" ? regionAoi(action.region) : state.aoi,
        start: action.region.firstMonth,
        end: action.region.lastMonth,
      };
    case "restore": // state parsed and validated from the URL hash
      return action.state;
    case "aoi":
      return { ...state, aoi: action.aoi };
    case "range":
      return { ...state, [action.which]: action.value };
    default:
      throw new Error(`Unknown action ${action.type}`);
  }
}

function useBoot() {
  const [boot, setBoot] = useState({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([loadRegions(), loadMeta()]).then(([r, m]) => {
      if (cancelled) return;
      const failures = [r, m].filter((x) => x.status === "rejected").map((x) => x.reason.message);
      setBoot(failures.length ? { status: "error", messages: failures } : { status: "ready", regions: r.value, meta: m.value });
    });
    return () => { cancelled = true; };
  }, []);
  return boot;
}

// cells_{region}.json is fetched the first time a region is needed, then cached.
function useCells(region) {
  const cache = useRef(new Map());
  const [state, setState] = useState({ id: null });
  useEffect(() => {
    if (!region) return undefined;
    if (cache.current.has(region.id)) {
      setState({ id: region.id, status: "ready", data: cache.current.get(region.id) });
      return undefined;
    }
    let cancelled = false;
    setState({ id: region.id, status: "loading" });
    loadCells(region)
      .then((data) => {
        cache.current.set(region.id, data);
        if (!cancelled) setState({ id: region.id, status: "ready", data });
      })
      .catch((err) => { if (!cancelled) setState({ id: region.id, status: "error", message: err.message }); });
    return () => { cancelled = true; };
  }, [region]);
  return region && state.id === region.id ? state : { status: "loading" };
}

const SMALL_AOI_NOTICE = "This area is smaller than the 0.25 degree grid (about 28 km). Counts are area-weighted estimates.";

function Header({ meta }) {
  return <PageHeader version={meta?.dataVersion} />;
}

export default function App() {
  const boot = useBoot();
  if (boot.status === "loading") {
    return <div className="app"><Header /><p className="status" role="status">Loading regions.json and meta.json…</p></div>;
  }
  if (boot.status === "error") {
    return (
      <div className="app"><Header />
        <section className="panel notice error" role="alert">
          <h2>Could not load the data</h2>
          {boot.messages.map((m) => <p key={m}>{m}</p>)}
        </section>
      </div>
    );
  }
  return <Root regions={boot.regions} meta={boot.meta} />;
}

// The landing page shows on every fresh load. A selection saved in the URL (a shared link, a reload) is
// restored when the visitor enters the workbench; otherwise the chosen region's full range is used.
function Root({ regions, meta }) {
  const [entered, setEntered] = useState(false);
  const [tour, setTour] = useState(false); // open the walkthrough as soon as the workbench appears
  const enter = (region, opts = {}) => {
    setTour(Boolean(opts.tour));
    const saved = stateFromHash(window.location.hash, regions);
    const next = saved && saved.regionId === region.id ? saved : reducer(null, { type: "preset", region });
    window.history.replaceState(null, "", formatHash(next));
    setEntered(true);
  };
  const home = () => { window.history.replaceState(null, "", window.location.pathname); setEntered(false); };
  if (!entered) return <div className="landing-root"><SyntheticBanner meta={meta} /><OfflineBanner /><Landing regions={regions} meta={meta} onEnter={enter} /></div>;
  return <Explorer regions={regions} meta={meta} onHome={home} initialTour={tour} />;
}

function Explorer({ regions, meta, onHome, initialTour }) {
  const [tourOpen, setTourOpen] = useState(false);
  const [page, setPage] = useState("workbench"); // "workbench" or "results"
  const [mapPick, setMapPick] = useState(null); // { regionId, month }: a month chosen with the map slider
  // From the landing page the tour waits a moment so the data panels exist before it looks for them.
  useEffect(() => {
    if (!initialTour) return undefined;
    const id = setTimeout(() => setTourOpen(true), 900);
    return () => clearTimeout(id);
  }, [initialTour]);
  const [state, dispatch] = useReducer(
    reducer, null, () => stateFromHash(window.location.hash, regions) ?? reducer(null, { type: "preset", region: regions[0] }),
  );
  const [fit, setFit] = useState(() => ({ bounds: aoiBounds(state.aoi), nonce: 0 }));

  // The hash always mirrors the selection; pasting or editing a hash in this tab restores it.
  const hash = formatHash(state);
  useEffect(() => {
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [hash]);
  useEffect(() => {
    const onHash = () => {
      const next = stateFromHash(window.location.hash, regions);
      if (!next || formatHash(next) === hash) return;
      dispatch({ type: "restore", state: next });
      setFit((f) => ({ bounds: aoiBounds(next.aoi), nonce: f.nonce + 1 }));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [regions, hash]);

  const matches = useMemo(() => regionsForAoi(state.aoi, regions), [state.aoi, regions]);
  const active = matches.find((m) => m.region.id === state.regionId) ?? matches[0] ?? null;
  useEffect(() => {
    if (active && active.region.id !== state.regionId) dispatch({ type: "region", region: active.region });
  }, [active, state.regionId]);

  const cells = useCells(active?.region ?? null);
  const rangeMsg = active ? rangeError(active.region, state.start, state.end) : null;
  const series = useMemo(
    () => (cells.status === "ready" && active ? aggregateSeries(cells.data, active.aoi) : null),
    [cells, active],
  );

  const setAoi = useCallback((aoi) => dispatch({ type: "aoi", aoi }), []);
  const applyAoi = useCallback((aoi) => { setAoi(aoi); setFit((f) => ({ bounds: aoiBounds(aoi), nonce: f.nonce + 1 })); }, [setAoi]);
  const pickRegion = useCallback((region) => { dispatch({ type: "preset", region }); setFit((f) => ({ bounds: region.bbox, nonce: f.nonce + 1 })); }, []);

  const inRange = series && !rangeMsg ? series.filter((r) => r.month >= state.start && r.month <= state.end) : null;
  const nCells = active ? gridCellsCovered(active.aoi, active.region.cellSize) : 0;
  // First and last MODIS-estimated month, read from the loaded cells file (meta.json does not hold them).
  const estMonths = series ? series.filter((r) => r.source === "modis_estimated") : [];
  const estimatedRange = estMonths.length ? [estMonths[0].month, estMonths[estMonths.length - 1].month] : null;

  // The month on the map: the one picked with the slider if it is still inside the date range, else the busiest month.
  const hotspotData = cells.status === "ready" ? cells.data : null;
  const peakIdx = hotspotData ? peakMonthIndex(hotspotData, state.start, state.end) : null;
  const pickedIdx = hotspotData && active && mapPick?.regionId === active.region.id ? hotspotData.months.indexOf(mapPick.month) : -1;
  const pickedOk = pickedIdx >= 0 && hotspotData.months[pickedIdx] >= state.start && hotspotData.months[pickedIdx] <= state.end;
  const monthIdx = pickedOk ? pickedIdx : peakIdx;
  const colourMax = useMemo(() => (hotspotData ? rampMax(hotspotData.cells) : 1), [hotspotData]);
  const hotspots = hotspotData && monthIdx !== null ? { data: hotspotData, index: monthIdx, max: colourMax } : null;

  const sizeNotice = active && estimatedRange
    ? smallAreaNotice({ meta, regionId: active.region.id, aoi: active.aoi, region: active.region, estimatedRange })
    : null;

  const dataReady = Boolean(active && inRange && inRange.length > 0);
  const context = dataReady ? {
    regionId: active.region.id, regionName: active.region.name, aoiText: describeAoi(active.aoi),
    start: inRange[0].month, end: inRange[inRange.length - 1].month, slug: aoiSlug(active.aoi),
    synthetic: isSynthetic(meta), dataVersion: meta.dataVersion,
  } : null;

  const left = (
    <LeftColumn
      regions={regions} region={active?.region ?? null} state={state} rangeMsg={rangeMsg}
      onRange={(which, value) => dispatch({ type: "range", which, value })}
      onFullRegion={() => active && pickRegion(active.region)}
      activeAoi={active?.aoi ?? null} fit={fit} onAoi={setAoi} onApplyAoi={applyAoi}
      hotspots={hotspots} peakIndex={peakIdx} onPickRegion={pickRegion}
      onMonth={(i) => active && hotspotData && setMapPick({ regionId: active.region.id, month: hotspotData.months[i] })}
    />
  );

  return (
    <div className="app">
      <SyntheticBanner meta={meta} />
      <OfflineBanner />
      <PageHeader regions={regions} regionId={active?.region.id ?? null} onRegion={pickRegion} version={meta.dataVersion} onHome={onHome} onTour={() => setTourOpen(true)} page={page} onPage={setPage} />
      {tourOpen && <Tour onClose={() => setTourOpen(false)} onView={setPage} />}
      <main className="page">
        {!active && <NoCoverage regions={regions} onPick={pickRegion} />}
        {active && active.wasClipped && (
          <p className="notice warn" role="status">
            Your area extends outside the processed region {active.region.name}. Data covers only the overlap (shaded).
          </p>
        )}
        {active && nCells < 4 && <p className="notice warn" role="status">{SMALL_AOI_NOTICE}</p>}
        {sizeNotice && (
          <p className="notice warn" role="status">
            {[sizeNotice.text, sizeNotice.measured, sizeNotice.thin, sizeNotice.fewSamples, sizeNotice.unmeasured].filter(Boolean).join(" ")}
          </p>
        )}
        {active && cells.status === "loading" && <p className="status" role="status">Loading cells_{active.region.id}.json…</p>}
        {active && cells.status === "error" && <p className="notice error field-error" role="alert">{cells.message}</p>}

        {dataReady ? (
          <ExportProvider>
            <Analytics
              key={active.region.id} fullSeries={series} rangeRows={inRange} context={context} left={left}
              meta={meta} regionId={active.region.id} page={page} onPage={setPage} onTour={() => setTourOpen(true)}
              more={() => (
                <MoreSections
                  meta={meta} region={active.region} aoi={active.aoi} rangeRows={inRange} cellsData={cells.data}
                  estimatedRange={estimatedRange} context={context}
                />
              )}
            />
          </ExportProvider>
        ) : (
          <div className="workrow"><div className="col-right" />{left}</div>
        )}
      </main>
      <Footer />
    </div>
  );
}
