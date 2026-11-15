import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StatCard from "./StatCard.jsx";

const pad = (n) => String(n).padStart(2, "0");
// Test-only rows: 2010-2013, 2010-2011 estimated, the last month provisional.
const rows = [];
for (let y = 2010; y <= 2013; y++) {
  for (let m = 1; m <= 12; m++) {
    rows.push({ month: `${y}-${pad(m)}`, count: y * 1 + m, lo: 0, hi: 0, source: y < 2012 ? "modis_estimated" : "viirs_native", provisional: false });
  }
}
rows[rows.length - 1].provisional = true;
const comparison = { month: "2013-12", count: 2025, label: "well above", percentDiff: 96, baselineMedian: 1000, provisional: true, source: "viirs_native" };
const render = (c) => renderToStaticMarkup(createElement(StatCard, { rows, comparison: c }));

describe("StatCard", () => {
  const out = render(comparison);
  const labels = [...out.matchAll(/<dt>([^<]+)<\/dt>/g)].map((m) => m[1]);

  it("has five items in the specified order, with Now vs normal first", () => {
    expect(labels).toEqual(["Now vs normal", "Detections in range", "Peak month", "Peak year", "Estimated share"]);
    expect(out.indexOf('class="stat stat-now"')).toBeLessThan(out.indexOf("Detections in range"));
  });

  it("shows the percent against the median of the same calendar month, and a provisional flag", () => {
    expect(out).toContain("+96%");
    expect(out).toContain("December 2013 against the median for December");
    expect(out).toContain("provisional");
  });

  it("does not flag a month that is not provisional", () => {
    expect(render({ ...comparison, provisional: false })).not.toContain("provisional");
  });

  it("reads the totals, peak month, peak year and estimated share from the rows", () => {
    const total = rows.reduce((a, r) => a + r.count, 0);
    expect(out).toContain(total.toLocaleString("en-US"));
    expect(out).toContain("December 2013"); // the highest count is in the last month
    expect(out).toContain(">2013<"); // peak year
    expect(out).toContain("50%"); // 24 of 48 months are estimated
    expect(out).toContain("24 of 48 months");
  });

  it("says so, instead of showing a number, when there is no baseline", () => {
    const none = render(null);
    expect(none).toContain(">n/a<");
    expect(none).toContain("No baseline years");
    expect(none).not.toContain("+96%");
  });

  it("states that the numbers are estimates", () => {
    expect(out).toContain("VIIRS-equivalent detections. Harmonized values are model estimates, not observations.");
  });
});
