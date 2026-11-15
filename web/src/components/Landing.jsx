import { lazy, Suspense, useRef, useState } from "react";
import { accuracyOf, TARGET_PCT } from "../lib/accuracy.js";

const GlobeLanding = lazy(() => import("./GlobeLanding.jsx")); // three.js and the borders data load after the text paints

// First MODIS-to-VIIRS handover: Suomi NPP VIIRS data starts in 2012 (see the availability check in
// pipeline/01_fetch.py). Years before it are MODIS-estimated; the last months of a record can be provisional.
const VIIRS_START_YEAR = 2012;

const yearOf = (m) => Number(m.slice(0, 4));

function yearsFor(region) {
  const first = yearOf(region.firstMonth);
  const last = yearOf(region.lastMonth);
  const provisionalYear = region.provisionalMonths?.length ? yearOf(region.provisionalMonths[0]) : null;
  const years = [];
  for (let y = first; y <= last; y++) {
    years.push({ y, kind: y < VIIRS_START_YEAR ? "est" : y === provisionalYear ? "prov" : "native" });
  }
  return years;
}

const KIND_LABEL = { est: "MODIS-estimated", native: "VIIRS native", prov: "includes provisional months" };
const deg = (v, pos, neg) => `${Math.abs(v)}°${v >= 0 ? pos : neg}`;

function RegionCard({ region, accuracy, active, onHover, onEnter }) {
  const years = yearsFor(region);
  const [w, s, e, n] = region.bbox;
  const nEst = years.filter((x) => x.kind === "est").length;
  return (
    <button type="button" className={`rcard${active ? " on" : ""}`} onClick={() => onEnter(region)}
      onMouseEnter={() => onHover(region.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(region.id)} onBlur={() => onHover(null)}>
      <span className="rcard-top"><strong>{region.name}</strong><span aria-hidden="true">→</span></span>
      <span className="rcard-meta">{deg(s, "N", "S")} to {deg(n, "N", "S")} · {deg(w, "E", "W")} to {deg(e, "E", "W")}</span>
      <span className="yearbar" role="img" aria-label={`${years.length} years, ${nEst} MODIS-estimated, ${years.length - nEst} VIIRS`}>
        {years.map((x) => <i key={x.y} className={x.kind} title={`${x.y}: ${KIND_LABEL[x.kind]}`} />)}
      </span>
      <span className="rcard-meta">{region.firstMonth} to {region.lastMonth} · {nEst} estimated years, {years.length - nEst} VIIRS years</span>
      {accuracy && (
        <span className={`rcard-acc ${accuracy.withinTarget ? "ok" : "warn"}`}>
          Estimated months: typical error {Math.round(accuracy.medianErrorPct)}% (bias {accuracy.biasPct >= 0 ? "+" : ""}{accuracy.biasPct.toFixed(1)}%),{" "}
          {accuracy.withinTarget ? `within the ${TARGET_PCT}% target` : `above the ${TARGET_PCT}% target, treat as rough`}
        </span>
      )}
    </button>
  );
}

const FLY_MS = 1600;
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export default function Landing({ regions, meta, onEnter: enter }) {
  const globe = useRef(null);
  const [leaving, setLeaving] = useState(false);
  const [hoverId, setHoverId] = useState(null);
  // Picking a region flies the globe to it for a moment, then opens the workbench. Without motion (or
  // without WebGL) it opens straight away. The timeout covers a hidden tab, where animation frames pause.
  const onEnter = (region, opts) => {
    if (leaving) return;
    if (reduced() || !globe.current) { enter(region, opts); return; }
    setLeaving(true);
    let opened = false;
    const open = () => { if (!opened) { opened = true; enter(region, opts); } };
    globe.current.fly(region, FLY_MS, open);
    setTimeout(open, FLY_MS + 900);
  };
  const [textured, setTextured] = useState(false);
  const first = regions.reduce((a, r) => (r.firstMonth < a ? r.firstMonth : a), regions[0].firstMonth);
  const last = regions.reduce((a, r) => (r.lastMonth > a ? r.lastMonth : a), regions[0].lastMonth);
  return (
    <div className={`landing${leaving ? " leaving" : ""}`}>
      <Suspense fallback={null}>
        <GlobeLanding ref={globe} regions={regions} hoverId={hoverId} onHover={setHoverId} onPick={onEnter} onTexture={setTextured} />
      </Suspense>
      <div className="landing-copy">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2c1 4-2 5-2 8 0 1.500 1 2.500 2 2.500S14 11.500 14 10c2 1.500 4 3.500 4 6.500A6 6 0 0 1 6 16.500C6 12 10 10 12 2z" fill="var(--fire)" />
          </svg>
          <div><strong className="brand-name">Burning Activity Calendar</strong><div className="brand-sub">MODIS + VIIRS harmonized</div></div>
        </div>

        <div className="hero">
          <div className="eyebrow">NASA FIRMS active fire · {first.slice(0, 4)}–{last.slice(0, 4)}</div>
          <h1 className="hero-title">Two satellite families. One consistent fire record.</h1>
          <p className="hero-sub">
            MODIS and VIIRS count fire differently, so their raw numbers cannot simply be added together. We harmonize them into one
            monthly series. Months before {VIIRS_START_YEAR} are MODIS estimates with a range, not observations; VIIRS months are native counts.
          </p>

        </div>
        <div className="hero hero-low">
          <div className="eyebrow">Choose a region</div>
          <div className="rcards">
            {regions.map((r) => <RegionCard key={r.id} region={r} accuracy={accuracyOf(meta, r.id)} active={hoverId === r.id} onHover={setHoverId} onEnter={onEnter} />)}
          </div>
          <div className="key">
            <span><i className="est" /> MODIS-estimated year</span>
            <span><i className="native" /> VIIRS native year</span>
            <span><i className="prov" /> includes provisional months</span>
          </div>
          <div className="cta-row">
            <button type="button" className="cta" onClick={() => onEnter(regions[0], { tour: true })}>Take the walkthrough</button>
            <button type="button" className="cta ghost-cta" onClick={() => onEnter(regions[0])}>Explore the workbench</button>
          </div>
        </div>

        <div className="landing-foot">
          <span className="orbit-key"><i className="amber" /> MODIS (Aqua) <i className="cyan" /> VIIRS (Suomi NPP, NOAA-20)</span>
          <span>Drag to rotate · click a region{meta?.dataVersion ? ` · data ${meta.dataVersion}` : ""}</span>
          <span>Fire data: NASA FIRMS{textured ? " · Earth imagery: NASA Blue Marble · star map: NASA SVS" : ""} · satellite orbits are an illustration, not a measurement</span>
        </div>
      </div>
    </div>
  );
}
