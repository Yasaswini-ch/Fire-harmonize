import { useMemo, useRef, useState } from "react";
import { interpolateViridis } from "d3-scale-chromatic";
import { buildCalendarSvg } from "../lib/calendarSvg.js";
import { buildCalendarModel } from "../lib/calendarModel.js";
import { fmt, monthLabel } from "../lib/format.js";
import { exportChartPng } from "../lib/image.js";
import { ExportButton } from "./ExportRegistry.jsx";
import { useRegisterExport } from "./exportContext.js";
import Sonify from "./Sonify.jsx";

// The burning activity calendar: years across the top, months down the side. Colour is the count (viridis, colour-blind
// safe, log scale by default). Data quality is never colour-only: estimated cells carry diagonal lines, provisional cells
// dots, the source change a white line, the five highest months a pink outline, and fire-season months a bar beside the
// month name. Cells are focusable (arrow keys move between them) and each has a full text label.
const compact = (v) => v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
const STOPS = [0, 0.25, 0.5, 0.75, 1].map((s) => interpolateViridis(s));
const SWATCH = "#3b528b";

export default function CalendarCard({ rows, baseline, season, recordStart, context }) {
  const [log, setLog] = useState(true);
  const [focusKey, setFocusKey] = useState(null);
  const [tip, setTip] = useState(null); // { cell, x, y }
  const refs = useRef({});
  const model = useMemo(() => buildCalendarModel({ rows, baseline, season, log }), [rows, baseline, season, log]);
  const n = model.years.length;
  const allCells = useMemo(() => model.months.flatMap((m) => m.cells).filter(Boolean), [model]);
  // the one cell in the tab order (roving tabindex): the last focused cell if it still exists, else the first
  const tabKey = allCells.some((c) => c.key === focusKey) ? focusKey : allCells[0]?.key;

  useRegisterExport("calendar", async () => {
    const { svg } = buildCalendarSvg(model);
    const svgEl = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    await exportChartPng({
      svgEl,
      title: "Burning activity calendar",
      lines: [`${context.regionName}: ${context.aoiText}`, `Period: ${context.start} to ${context.end}`],
      legend: [
        { kind: "ramp", stops: STOPS, min: fmt(model.min), max: fmt(model.max), note: model.log ? "log scale (log of count + 1)" : "linear scale" },
        { kind: "swatch", fill: SWATCH, label: "VIIRS native" },
        { kind: "swatch", base: SWATCH, fill: "url(#hatch)", label: "MODIS-estimated (diagonal lines)" },
        { kind: "swatch", base: SWATCH, fill: "url(#dots)", label: "Provisional (dots)" },
        { kind: "line", stroke: "#ffffff", label: "Source changes" },
        { kind: "line", stroke: "#ff5fa2", label: "Top 5 months" },
        ...(season ? [{ kind: "swatch", fill: "#f0b84a", label: "Fire season months" }] : []),
      ],
      filename: `fire-harmonize_${context.regionId}_calendar_${context.slug}_${context.start}_${context.end}.png`,
    });
  });

  function show(cell, el) {
    setTip({ cell, x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop });
  }

  function onKeyDown(e, cell) {
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!d) return;
    e.preventDefault();
    let mi = cell.monthIndex + d[0];
    let col = cell.col + d[1];
    while (mi >= 0 && mi < 12 && col >= 0 && col < n) { // skip months with no data
      const next = model.months[mi].cells[col];
      if (next) { setFocusKey(next.key); refs.current[next.key]?.focus(); return; }
      mi += d[0];
      col += d[1];
    }
  }

  const colOf = (c) => c + 2; // grid column of a year: column 1 holds the month names
  const medianCol = n + 2;
  return (
    <section className="card cal-card" aria-label="Calendar heatmap">
      <div className="card-head">
        <h2>Burning activity calendar</h2>
        <div className="head-actions">
          <div className="seg" role="group" aria-label="Colour scale">
            <button type="button" aria-pressed={log} className={log ? "" : "ghost"} onClick={() => setLog(true)}>Log</button>
            <button type="button" aria-pressed={!log} className={log ? "ghost" : ""} onClick={() => setLog(false)}>Linear</button>
          </div>
          <ExportButton name="calendar" className="ghost">Download image</ExportButton>
        </div>
      </div>
      <p className="hint">The record starts in {monthLabel(recordStart)}. One cell per month; the colour is the number of detections.</p>
      <details className="fold">
        <summary>How to read this</summary>
        <ul className="howto">
          <li>Each column is a year and each row a calendar month. The colour is the number of detections in your area (VIIRS-equivalent).</li>
          <li>Diagonal lines mark months estimated from MODIS. Dots mark provisional months, which may still change.</li>
          <li>The white line marks where the source changes from MODIS estimates to VIIRS observations.</li>
          <li>The pink outline marks the five highest months in the range. The bar beside a month name marks the fire season.</li>
        </ul>
      </details>

      <div className="cal-scroll">
        <div className={`cal${model.hasMedian ? "" : " no-median"}`} style={{ "--n": n }} role="group" aria-label="Monthly detection counts, years across and months down"
          onMouseLeave={() => setTip(null)}>
          {model.spans.estimated && (
            <div className="cal-bracket est" style={{ gridRow: 1, gridColumn: `${colOf(model.spans.estimated.startCol)} / span ${model.spans.estimated.span}` }}>
              MODIS-estimated · {model.spans.estimated.from} to {model.spans.estimated.to}
            </div>
          )}
          {model.spans.native && (
            <div className="cal-bracket native" style={{ gridRow: 1, gridColumn: `${colOf(model.spans.native.startCol)} / span ${model.spans.native.span}` }}>
              VIIRS native · {model.spans.native.from} to {model.spans.native.to}
            </div>
          )}
          {model.years.map((y, c) => (
            <div key={y} className={`cal-year${y % 4 === 0 ? " yk" : ""}`} style={{ gridRow: 2, gridColumn: colOf(c) }}>{y}</div>
          ))}
          {model.hasMedian && <div className="cal-median cal-median-head" style={{ gridRow: 2, gridColumn: medianCol }}>Median</div>}

          {model.months.map((m) => (
            <MonthRow key={m.index} m={m} refs={refs} tabKey={tabKey} medianCol={medianCol} hasMedian={model.hasMedian}
              onShow={show} onHide={() => setTip(null)} onFocusCell={(c) => setFocusKey(c.key)} onKeyDown={onKeyDown} />
          ))}

          <div className="cal-month cal-total-label" style={{ gridRow: 15, gridColumn: 1 }}>Total</div>
          {model.totals.map((t, c) => (
            <div key={t.year} className={`cal-total${t.year % 4 === 0 ? " yk" : ""}`} style={{ gridRow: 15, gridColumn: colOf(c) }} title={`${t.year}: ${fmt(t.total)}${t.partial ? ` (partial year, ${t.months} months)` : ""}`}>
              {compact(t.total)}{t.partial ? " part." : ""}
            </div>
          ))}

          {tip && (
            <div className="tip" role="presentation" style={{ left: tip.x, top: tip.y }}>{tip.cell.label}</div>
          )}
        </div>
      </div>

      <div className="cal-legend">
        <div className="cal-ramp">
          <span className="cal-scale">{model.scaleLabel}</span>
          <span>{fmt(model.min)}</span>
          <i style={{ background: `linear-gradient(to right, ${STOPS.join(", ")})` }} />
          <span>{fmt(model.max)}</span>
        </div>
        <ul className="legend-items">
          <li><i className="sw sw-native" /> VIIRS native</li>
          <li><i className="sw sw-est" /> MODIS-estimated</li>
          <li><i className="sw sw-prov" /> Provisional</li>
          <li><i className="sw sw-change" /> Source changes</li>
          <li><i className="sw sw-top" /> Top 5 months</li>
          <li><i className="sw sw-season" /> Fire season months</li>
        </ul>
      </div>

      <Sonify key={`${rows[0].month}-${rows.length}`} rows={rows} />
    </section>
  );
}

function MonthRow({ m, refs, tabKey, medianCol, hasMedian, onShow, onHide, onFocusCell, onKeyDown }) {
  const row = m.index + 3;
  return (
    <>
      <div className={`cal-month${m.inSeason ? " season" : ""}`} style={{ gridRow: row, gridColumn: 1 }}>{m.name}</div>
      {m.cells.map((c, col) => {
        if (!c) return <div key={`none-${col}`} className="cal-cell none" aria-hidden="true" style={{ gridRow: row, gridColumn: col + 2 }} />;
        const cls = ["cal-cell", c.status, c.edgeLeft && "el", c.edgeTop && "et", c.top5 && "top"].filter(Boolean).join(" ");
        return (
          <div key={c.key} role="img" aria-label={c.label} className={cls} tabIndex={c.key === tabKey ? 0 : -1}
            ref={(el) => { if (el) refs.current[c.key] = el; else delete refs.current[c.key]; }}
            style={{ gridRow: row, gridColumn: col + 2, backgroundColor: interpolateViridis(c.t) }}
            onMouseEnter={(e) => onShow(c, e.currentTarget)} onMouseLeave={onHide}
            onFocus={(e) => { onFocusCell(c); onShow(c, e.currentTarget); }} onBlur={onHide}
            onKeyDown={(e) => onKeyDown(e, c)} />
        );
      })}
      {hasMedian && (
        <div className="cal-median" style={{ gridRow: row, gridColumn: medianCol }}>{m.median === null ? "n/a" : compact(m.median)}</div>
      )}
    </>
  );
}
