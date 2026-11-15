import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AtAGlance from "./AtAGlance.jsx";

const pad = (n) => String(n).padStart(2, "0");
const rows = [];
for (let y = 2010; y <= 2013; y++) for (let m = 1; m <= 12; m++) rows.push({ month: `${y}-${pad(m)}`, count: 10 + m + (y - 2010) * 5, lo: 0, hi: 0, source: y < 2012 ? "modis_estimated" : "viirs_native", provisional: false });
const props = {
  regionName: "Zambia", rows,
  comparison: { month: "2013-12", count: 37, label: "above", percentDiff: 12, provisional: false },
  season: { months: [6, 7], length: 2, share: 0.8, peakMonth: 7 },
  anomaly: null,
  accuracy: { medianErrorPct: 18.5, biasPct: 1.8, model: "ratio per calendar month", fitWindow: ["2012-02", "2021-12"], withinTarget: true },
};
const html = (extra = {}) => renderToStaticMarkup(createElement(AtAGlance, { ...props, ...extra }));

describe("AtAGlance", () => {
  const out = html();
  it("has the three parts: what we did, what it shows for the region, and the reading guide", () => {
    expect(out).toContain("What we did");
    expect(out).toContain("What it shows for Zambia");
    expect(out).toContain("How to read the graphs");
    for (const g of ["The map", "The calendar", "Seasonal profile", "Annual anomaly", "Now vs normal"]) expect(out).toContain(g);
  });
  it("carries numbers computed from the rows and the accuracy object", () => {
    expect(out).toContain("24 of the 48 months");
    expect(out).toContain("off by 19%");
    expect(out).toContain("December 2013 has 37 detections, +12% against the median for December");
  });
  it("is plain section content: no card of its own and no nested disclosure, because it sits in a collapsed section", () => {
    expect(out).not.toContain('class="card');
    expect(out).not.toContain("<details");
  });
  it("offers the walkthrough only when it is given a way to start it", () => {
    expect(out).not.toContain("Take the walkthrough");
    expect(html({ onTour: () => {} })).toContain("Take the walkthrough");
  });
});
