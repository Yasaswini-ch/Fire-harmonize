import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CalendarCard from "./CalendarCard.jsx";
import { fireSeasonWindow, monthlyMedianBaseline } from "../lib/stats.js";

// Test-only series: 2001-2012 estimated, 2013-2015 native, the last month provisional.
const pad = (n) => String(n).padStart(2, "0");
function series(first = "2001-01") {
  const rows = [];
  for (let y = 2001; y <= 2015; y++) {
    for (let m = 1; m <= 12; m++) {
      const month = `${y}-${pad(m)}`;
      if (month < first) continue;
      const est = y < 2013;
      const count = [0, 0, 0, 0, 10, 20, 40, 20, 10, 0, 0, 0][m - 1] * (1 + (y % 3) * 0.2);
      rows.push({ month, count, lo: est ? count * 0.8 : count, hi: est ? count * 1.5 : count, source: est ? "modis_estimated" : "viirs_native", provisional: false });
    }
  }
  rows[rows.length - 1].provisional = true;
  return rows;
}
const context = { regionId: "r", regionName: "R", aoiText: "a", start: "2001-01", end: "2015-12", slug: "a" };
const render = (rows, extra = {}) => {
  const baseline = extra.baseline === undefined ? monthlyMedianBaseline(rows, 2001, 2014, 2015) : extra.baseline;
  const season = baseline ? fireSeasonWindow(rows, 2001, 2014, 2015) : null;
  return renderToStaticMarkup(createElement(CalendarCard, { rows, baseline, season, recordStart: rows[0].month, context }));
};

describe("CalendarCard", () => {
  const rows = series();
  const out = render(rows);

  it("has the title, the record start, and the Log and Linear buttons with Log pressed by default", () => {
    expect(out).toContain("Burning activity calendar");
    expect(out).toContain("The record starts in January 2001");
    expect(out).toMatch(/aria-pressed="true"[^>]*>Log</);
    expect(out).toMatch(/aria-pressed="false"[^>]*>Linear</);
    expect(out).toContain("Download image");
  });

  it("labels the brackets over the columns with years read from the data", () => {
    expect(out).toContain("MODIS-estimated · 2001 to 2012");
    expect(out).toContain("VIIRS native · 2013 to 2015");
  });

  it("has one row per calendar month, a year label per year and a Total row", () => {
    for (const name of ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]) expect(out).toContain(`>${name}<`);
    expect((out.match(/class="cal-year[ "]/g) ?? [])).toHaveLength(15); // a second class marks every fourth year, which narrow screens keep
    expect(out).toContain(">Total<");
  });

  it("gives every cell a text label, and exactly one cell is in the tab order", () => {
    expect(out).toContain('aria-label="July 2004: 40 detections, estimated, range 32 to 60"');
    expect(out).toContain('aria-label="July 2013: 40 detections, VIIRS native"');
    expect((out.match(/class="cal-cell[^"]*"[^>]*tabindex="0"|tabindex="0"[^>]*class="cal-cell/g) ?? [])).toHaveLength(1);
    expect(out).toContain('role="img"');
  });

  it("marks estimated cells, provisional cells and the source change with classes, not colour alone", () => {
    expect(out).toContain("cal-cell estimated");
    expect(out).toContain("cal-cell provisional");
    expect(out).toContain(" el"); // first native cell of a row: the source-change line
    expect(out).toContain(" top"); // one of the five highest months: the pink outline
  });

  it("marks fire-season months by the bar beside the month name and carries the baseline median column", () => {
    expect(out).toContain("cal-month season");
    expect(out).toContain(">Median<");
    expect(out).toContain('class="cal-median"');
  });

  it("omits the median column when there is no baseline", () => {
    const bare = render(rows, { baseline: null });
    expect(bare).not.toContain(">Median<");
    expect(bare).toContain("cal no-median");
  });

  it("writes 'part.' under a partial first year and no 'part.' when every year is complete", () => {
    expect(render(series("2001-08"))).toContain("part.");
    const complete = render(series("2001-01").filter((r) => r.month <= "2014-12"));
    expect(complete).not.toContain("part.");
  });

  it("states the active scale with its minimum and maximum, and lists every legend item", () => {
    expect(out).toContain("Log scale");
    for (const s of ["VIIRS native", "MODIS-estimated", "Provisional", "Source changes", "Top 5 months", "Fire season months"]) expect(out).toContain(s);
  });

  it("keeps the 'How to read this' text inside a disclosure attached to the calendar", () => {
    expect(out).toMatch(/<details class="fold"><summary>How to read this<\/summary>/);
  });

  it("draws months with no data as hidden dashed placeholders", () => {
    expect(render(series("2001-08"))).toContain('class="cal-cell none"');
  });
});
