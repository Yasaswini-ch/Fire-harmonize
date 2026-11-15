import { describe, expect, it } from "vitest";
import { buildFindings } from "./findings.js";
import { rankingOf } from "./ranking.js";

const rows = [];
for (let y = 2010; y <= 2013; y++) {
  for (let m = 1; m <= 12; m++) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const est = month < "2012-02";
    const count = month === "2012-08" ? 1000 : month === "2011-08" ? 900 : 100;
    rows.push({ month, count, lo: est ? count * 0.8 : count, hi: est ? count * 1.25 : count, source: est ? "modis_estimated" : "viirs_native", provisional: false });
  }
}
const base = { comparison: null, season: null, anomaly: null, accuracy: null };
const shows = (extra) => Object.fromEntries(buildFindings({ rows, ...base, ...extra }).shows.map((s) => [s.label, s.text]));

describe("findings with a ranking", () => {
  const ranking = rankingOf(rows);
  it("says how often the busiest month and year come out on top, using the simulated draws", () => {
    const s = shows({ ranking });
    expect(s["Busiest month"]).toMatch(/^August 2012, with 1,000 detections\. August 2012 is the busiest month in \d+%( to \d+%)? of draws within the stated ranges; next is August 2011/);
    expect(s["Busiest year"]).toContain("of draws within the stated ranges");
  });
  it("explains how the chances were worked out", () => {
    expect(buildFindings({ rows, ...base, ranking }).rankingNote).toContain("two assumptions");
  });
  it("lists the shaky members of the five highest months", () => {
    const s = shows({ ranking });
    expect(s["Five highest months"]).toContain("Chance of really being among the five highest months");
  });
  it("adds nothing without a ranking, or when every month in the range is observed", () => {
    expect(shows({})["Busiest month"]).toBe("August 2012, with 1,000 detections.");
    expect(buildFindings({ rows, ...base }).rankingNote).toBeNull();
    const observed = rows.filter((r) => r.source === "viirs_native");
    const f = buildFindings({ rows: observed, ...base, ranking: rankingOf(observed) });
    expect(f.rankingNote).toBeNull();
    expect(f.shows.find((s) => s.label === "Busiest month").text).toBe("August 2012, with 1,000 detections.");
  });
});
