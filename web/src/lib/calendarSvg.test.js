import { describe, expect, it } from "vitest";
import { buildCalendarModel } from "./calendarModel.js";
import { buildCalendarSvg } from "./calendarSvg.js";

const pad = (n) => String(n).padStart(2, "0");
function rows(first = "2010-01") {
  const out = [];
  for (let y = 2010; y <= 2013; y++) {
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${pad(m)}`;
      if (month < first) continue;
      const est = y < 2012 || (y === 2012 && m === 1); // January 2012 is still estimated, so the source change steps between rows
      out.push({ month, count: 10 + m + (y - 2010) * 5, lo: 5, hi: 40, source: est ? "modis_estimated" : "viirs_native", provisional: false });
    }
  }
  out[out.length - 1].provisional = true;
  return out;
}
const baseline = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, n: 3, median: (i + 1) * 100 }));

describe("buildCalendarSvg", () => {
  const model = buildCalendarModel({ rows: rows(), baseline, season: { months: [7, 8] } });
  const { svg, width, height } = buildCalendarSvg(model);

  it("is a standalone SVG that states its own size (the export measures it from these attributes)", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${width}" height="${height}"`);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(300);
  });

  it("defines the hatch and dot patterns the legend of the exported image refers to", () => {
    expect(svg).toContain('<pattern id="hatch"');
    expect(svg).toContain('<pattern id="dots"');
  });

  it("draws one cell per month with data, the brackets with data-derived years, and a label per year", () => {
    expect((svg.match(/fill="url\(#hatch\)"/g) ?? [])).toHaveLength(model.months.flatMap((m) => m.cells).filter((c) => c?.status === "estimated").length);
    expect(svg).toContain("MODIS-estimated · 2010 to 2011");
    expect(svg).toContain("VIIRS native · 2012 to 2013");
    for (const y of [2010, 2011, 2012, 2013]) expect(svg).toContain(`>${y}</text>`);
  });

  it("outlines exactly the five highest months in pink", () => {
    expect((svg.match(/stroke="#ff5fa2"/g) ?? [])).toHaveLength(5);
  });

  it("marks the one provisional month with the dot overlay, and the source change with white edges", () => {
    expect((svg.match(/fill="url\(#dots\)"/g) ?? [])).toHaveLength(1);
    expect(svg).toContain('width="2" height="24" fill="#fff"'); // a left edge
    expect(svg).toContain('width="26" height="2" fill="#fff"'); // the top edge, under the estimated January 2012
  });

  it("writes the median column only when there is a baseline, and 'part.' only for partial years", () => {
    expect(svg).toContain(">Median</text>");
    const bare = buildCalendarSvg(buildCalendarModel({ rows: rows() })).svg;
    expect(bare).not.toContain(">Median</text>");
    expect(bare).not.toContain("part.");
    expect(buildCalendarSvg(buildCalendarModel({ rows: rows("2010-08") })).svg).toContain("part.");
  });

  it("marks fire-season month names with the accent bar", () => {
    expect((svg.match(/<rect x="0" y="[\d.]+" width="3" height="24" fill="#f0b84a"\/>/g) ?? [])).toHaveLength(2);
  });
});
