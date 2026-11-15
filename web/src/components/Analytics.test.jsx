import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Analytics from "./Analytics.jsx";
import { cellLabel } from "../lib/format.js";

// recharts ships ES modules that this test environment cannot load, and the charts are third-party drawing code. They are
// replaced by empty components here; everything else (the calendar, the cards, the notices) renders for real.
vi.mock("recharts", () => {
  const Stub = () => null;
  return {
    Area: Stub, Bar: Stub, BarChart: Stub, CartesianGrid: Stub, Cell: Stub, ComposedChart: Stub, ErrorBar: Stub, Legend: Stub, Line: Stub,
    ReferenceLine: Stub, Tooltip: Stub, XAxis: Stub, YAxis: Stub,
    ResponsiveContainer: ({ children }) => children ?? null,
  };
});

// Synthetic series inside the test only: 2001-2012 MODIS-estimated, 2013-2015 VIIRS native, last month provisional.
const PROFILE = [0, 0, 0, 0, 10, 20, 40, 20, 10, 0, 0, 0];
function makeSeries(firstYear, lastYear, scale = 1) {
  const rows = [];
  for (let y = firstYear; y <= lastYear; y++) {
    PROFILE.forEach((v, i) => {
      const est = y < 2013;
      const count = v * scale * (1 + (y % 3) * 0.2);
      rows.push({
        month: `${y}-${String(i + 1).padStart(2, "0")}`, count, lo: est ? count * 0.8 : count, hi: est ? count * 1.5 : count,
        source: est ? "modis_estimated" : "viirs_native", provisional: false,
      });
    });
  }
  rows[rows.length - 1].provisional = true;
  return rows;
}
const context = { regionId: "r", regionName: "Region", aoiText: "area", start: "2001-01", end: "2015-12", slug: "area" };
const html = (full, range) => renderToStaticMarkup(createElement(Analytics, { fullSeries: full, rangeRows: range ?? full, context }));

describe("Analytics states", () => {
  const full = makeSeries(2001, 2015);

  it("renders the stat card, the calendar with accessible labels, the three cards and the anomaly chart", () => {
    const out = html(full);
    expect(out).toContain('aria-label="Summary"');
    expect(out).toContain("The record starts in January 2001");
    // years divisible by 3 have factor 1, so July = 40; estimated lo/hi = x0.8 and x1.5
    expect(out).toContain('aria-label="July 2004: 40 detections, estimated, range 32 to 60"');
    expect(out).toContain('aria-label="July 2013: 40 detections, VIIRS native"');
    expect(out).toContain("provisional");
    expect(out).toContain("Log scale");
    expect(out).toContain("Fire season");
    expect(out).toContain("Now vs normal");
    expect(out).toContain("Seasonal profile");
    expect(out).toContain("Annual anomaly");
  });

  it("shows an explicit empty state, no calendar and no charts, when the area has zero detections", () => {
    const out = html(makeSeries(2001, 2015, 0));
    expect(out).toContain("No detections in this area and period");
    expect(out).not.toContain("Calendar heatmap");
    expect(out).not.toContain("Annual anomaly");
  });

  it("hides the anomaly chart with a reason when the range is under 12 months, and still shows the calendar", () => {
    const out = html(full, full.filter((r) => r.month >= "2014-03" && r.month <= "2014-08"));
    expect(out).toContain("Hidden: the selected range is 6 months");
    expect(out).toContain("Calendar heatmap");
  });

  it("cautions when the baseline is under 5 years", () => {
    const out = html(makeSeries(2012, 2015));
    expect(out).toContain("Caution: the monthly baseline rests on 3 years");
  });

  it("does not caution with a long baseline", () => {
    expect(html(full)).not.toContain("Caution:");
  });

  it("does not put the results summary at the top of the page, and hands what the collapsed sections need to `more`", () => {
    let received = null;
    const out = renderToStaticMarkup(createElement(Analytics, { fullSeries: full, rangeRows: full, context, more: (x) => { received = x; return createElement("i", { id: "more-slot" }); } }));
    expect(out).not.toContain("Results at a glance");
    expect(out).toContain('id="more-slot"');
    expect(Object.keys(received)).toEqual(["comparison"]);
    expect(received.comparison.month).toBe("2015-12");
  });

  it("shows the results and the method on the results page instead of the calendar", () => {
    const out = renderToStaticMarkup(createElement(Analytics, { fullSeries: full, rangeRows: full, context, page: "results" }));
    expect(out).toContain("Results and how to read the graphs");
    expect(out).toContain("How the numbers are made");
    expect(out).toContain("Choices we made, and what each costs");
    expect(out).not.toContain('aria-label="Calendar heatmap"');
  });

  it("puts the left column after the stat card and the calendar in the page order, so a narrow screen stacks in that order", () => {
    const out = renderToStaticMarkup(createElement(Analytics, { fullSeries: full, rangeRows: full, context, left: createElement("div", { id: "left-col" }) }));
    expect(out.indexOf('aria-label="Summary"')).toBeLessThan(out.indexOf('aria-label="Calendar heatmap"'));
    expect(out.indexOf('aria-label="Calendar heatmap"')).toBeLessThan(out.indexOf('id="left-col"'));
    expect(out.indexOf('id="left-col"')).toBeLessThan(out.indexOf('aria-label="Seasonal profile"'));
  });
});

describe("cellLabel", () => {
  it("matches the documented format", () => {
    expect(cellLabel({ month: "2019-03", count: 12430, lo: 9800, hi: 15100, source: "modis_estimated", provisional: false }))
      .toBe("March 2019: 12,430 detections, estimated, range 9,800 to 15,100");
  });
});
