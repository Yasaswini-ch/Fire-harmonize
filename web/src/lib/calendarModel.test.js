import { describe, expect, it } from "vitest";
import { buildCalendarModel, statusOf } from "./calendarModel.js";

// Test-only series: 2011-10..2012-01 estimated, 2012-02..2013-12 native, the last month provisional.
const pad = (n) => String(n).padStart(2, "0");
function series() {
  const rows = [];
  for (let y = 2011; y <= 2013; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2011 && m < 10) continue; // the record starts in October 2011
      const est = y === 2011 || (y === 2012 && m === 1);
      const count = (y - 2010) * 10 + m;
      rows.push({ month: `${y}-${pad(m)}`, count, lo: est ? count * 0.5 : count, hi: est ? count * 2 : count, source: est ? "modis_estimated" : "viirs_native", provisional: false });
    }
  }
  rows[rows.length - 1].provisional = true;
  return rows;
}
const cell = (model, year, mi) => model.months[mi].cells[model.years.indexOf(year)];

describe("buildCalendarModel", () => {
  const model = buildCalendarModel({ rows: series() });

  it("lays out years across and twelve months down, with no cell for months outside the record", () => {
    expect(model.years).toEqual([2011, 2012, 2013]);
    expect(model.months).toHaveLength(12);
    expect(cell(model, 2011, 0)).toBeNull(); // January 2011 is before the record starts
    expect(cell(model, 2011, 9).month).toBe("2011-10");
  });

  it("gives each cell its status: estimated, native, or provisional", () => {
    expect(cell(model, 2011, 10).status).toBe("estimated");
    expect(cell(model, 2012, 0).status).toBe("estimated");
    expect(cell(model, 2012, 1).status).toBe("native");
    expect(cell(model, 2013, 11).status).toBe("provisional");
    expect(statusOf({ source: "viirs_native", provisional: false })).toBe("native");
  });

  it("derives the bracket years from the data: estimated years end before the first native year", () => {
    expect(model.spans.estimated).toEqual({ from: 2011, to: 2011, startCol: 0, span: 1 });
    expect(model.spans.native).toEqual({ from: 2012, to: 2013, startCol: 1, span: 2 });
  });

  it("marks the source change: a left edge on the first native cell of each month row, and one top edge where it steps", () => {
    expect(cell(model, 2012, 1).edgeLeft).toBe(true); // February: first native cell of its row (the record starts in October, so no estimated cell sits left of it)
    expect(cell(model, 2013, 0).edgeLeft).toBe(true); // January: 2012-01 is still estimated, so 2013 is its first native cell
    expect(cell(model, 2012, 0).edgeLeft).toBe(false);
    expect(cell(model, 2013, 1).edgeLeft).toBe(false); // not the first native cell of its row
    const tops = model.months.flatMap((m) => m.cells).filter((c) => c && c.edgeTop);
    expect(tops.map((c) => c.month)).toEqual(["2012-02"]); // below the estimated January 2012
  });

  it("outlines exactly the five highest months and says so in the accessible label", () => {
    const top = model.months.flatMap((m) => m.cells).filter((c) => c && c.top5);
    expect(top).toHaveLength(5);
    expect(top.map((c) => c.month).sort()).toEqual(["2013-08", "2013-09", "2013-10", "2013-11", "2013-12"]);
    expect(top[0].label).toContain("one of the five highest months");
    expect(cell(model, 2012, 1).label).not.toContain("five highest");
  });

  it("builds the label in the documented format, with the range for estimated months", () => {
    expect(cell(model, 2011, 9).label).toBe("October 2011: 20 detections, estimated, range 10 to 40");
    expect(cell(model, 2012, 1).label).toBe("February 2012: 22 detections, VIIRS native");
  });

  it("flags partial first and last years from the months present", () => {
    expect(model.totals.map((t) => [t.year, t.months, t.partial])).toEqual([[2011, 3, true], [2012, 12, false], [2013, 12, false]]);
    expect(model.totals[1].total).toBe(Array.from({ length: 12 }, (_, i) => 20 + i + 1).reduce((a, b) => a + b, 0));
  });

  it("uses a log scale by default colouring and a linear one on request, from the same min and max", () => {
    const lin = buildCalendarModel({ rows: series(), log: false });
    const lg = buildCalendarModel({ rows: series(), log: true });
    expect([lin.min, lin.max]).toEqual([lg.min, lg.max]);
    expect(lin.scaleLabel).toBe("Linear scale");
    expect(lg.scaleLabel).toBe("Log scale");
    expect(cell(lg, 2011, 9).t).toBe(0);
    expect(cell(lg, 2013, 11).t).toBe(1);
    // a middling count sits higher on a log scale than on a linear one
    expect(cell(lg, 2012, 5).t).toBeGreaterThan(cell(lin, 2012, 5).t);
  });

  it("marks fire-season months and carries the baseline median per calendar month", () => {
    const baseline = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, n: i === 3 ? 0 : 5, median: (i + 1) * 100 }));
    const m = buildCalendarModel({ rows: series(), baseline, season: { months: [6, 7, 8] } });
    expect(m.months.map((r) => r.inSeason)).toEqual([false, false, false, false, false, true, true, true, false, false, false, false]);
    expect(m.months[0].median).toBe(100);
    expect(m.months[3].median).toBeNull(); // no baseline years for April
    expect(m.hasMedian).toBe(true);
    expect(model.hasMedian).toBe(false);
  });

  it("has no estimated bracket when the range starts after the source change, and no native bracket for an all-estimated range", () => {
    const later = buildCalendarModel({ rows: series().filter((r) => r.month >= "2013-01") });
    expect(later.spans.estimated).toBeNull();
    expect(later.spans.native).toMatchObject({ from: 2013, span: 1 });
    const early = buildCalendarModel({ rows: series().filter((r) => r.month <= "2011-12") });
    expect(early.spans.native).toBeNull();
    expect(early.spans.estimated).toMatchObject({ from: 2011, span: 1 });
    expect(early.months.flatMap((m) => m.cells).filter((c) => c && (c.edgeLeft || c.edgeTop))).toHaveLength(0);
  });

  it("copes with a flat series (every count the same)", () => {
    const flat = series().map((r) => ({ ...r, count: 5, lo: 5, hi: 5 }));
    const m = buildCalendarModel({ rows: flat });
    expect(m.months.flatMap((r) => r.cells).filter(Boolean).every((c) => c.t === 0)).toBe(true);
  });
});
