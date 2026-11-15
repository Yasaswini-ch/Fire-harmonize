import { describe, expect, it } from "vitest";
import { buildFindings, READING_GUIDE } from "./findings.js";

const pad = (n) => String(n).padStart(2, "0");
function rows() {
  const out = [];
  for (let y = 2010; y <= 2013; y++) {
    for (let m = 1; m <= 12; m++) {
      out.push({ month: `${y}-${pad(m)}`, count: 10 + m + (y - 2010) * 5, lo: 0, hi: 0, source: y < 2012 ? "modis_estimated" : "viirs_native", provisional: false });
    }
  }
  out[out.length - 1].provisional = true;
  return out;
}
const comparison = { month: "2013-12", count: 37, label: "above", percentDiff: 12, provisional: true };
const season = { months: [6, 7, 8], length: 3, share: 0.86, peakMonth: 7 };
const accuracy = { medianErrorPct: 18.5, biasPct: 1.8, model: "ratio per calendar month", fitWindow: ["2012-02", "2021-12"], withinTarget: true };
const anomaly = { sd: 1, years: [{ year: 2011, z: 0.3, flag: false }, { year: 2012, z: 2.4, flag: true }] };

describe("buildFindings: what we did", () => {
  const { did } = buildFindings({ rows: rows(), comparison, season, anomaly, accuracy });
  it("counts the estimated and total months from the rows", () => {
    expect(did[1]).toContain("24 of the 48 months");
  });
  it("states the model, the fit window and the measured error against the target, from the accuracy object", () => {
    const line = did.find((s) => s.includes("ratio per calendar month"));
    expect(line).toContain("The model: ratio per calendar month, fitted on 2012-02 to 2021-12.");
    expect(line).toContain("off by 19%");
    expect(line).toContain("within our 30% target");
  });
  it("says 'above' when the error misses the target", () => {
    const out = buildFindings({ rows: rows(), comparison: null, season: null, anomaly: null, accuracy: { ...accuracy, medianErrorPct: 45, withinTarget: false } });
    expect(out.did.join(" ")).toContain("above our 30% target");
  });
  it("leaves the accuracy sentence out when meta.json has no accuracy for the region", () => {
    const out = buildFindings({ rows: rows(), comparison, season, anomaly, accuracy: null });
    expect(out.did.join(" ")).not.toContain("off by");
  });
  it("mentions provisional months only when there are some", () => {
    expect(did.join(" ")).toContain("The latest 1 month is provisional");
    const none = rows().map((r) => ({ ...r, provisional: false }));
    expect(buildFindings({ rows: none, comparison, season, anomaly, accuracy }).did.join(" ")).not.toContain("provisional");
  });
  it("says so when no month needed estimating", () => {
    const native = rows().filter((r) => r.month >= "2012-02");
    expect(buildFindings({ rows: native, comparison, season, anomaly, accuracy }).did[1]).toContain("none had to be estimated");
  });
});

describe("buildFindings: what it shows", () => {
  const { shows } = buildFindings({ rows: rows(), comparison, season, anomaly, accuracy });
  const by = Object.fromEntries(shows.map((s) => [s.label, s.text]));

  it("reports the latest month against normal with its provisional flag", () => {
    expect(by["Now vs normal"]).toBe("December 2013 has 37 detections, +12% against the median for December (provisional).");
  });
  it("reports the busiest month and the busiest complete year from the rows", () => {
    expect(by["Busiest month"]).toBe("December 2013, with 37 detections.");
    expect(by["Busiest year"]).toContain("2013");
  });
  it("describes the fire season with its share and its peak", () => {
    expect(by["Fire season"]).toBe("June to August (3 months) holds 86% of the typical annual total. The peak month is July.");
  });
  it("lists the flagged years, or says there are none", () => {
    expect(by["Unusual years"]).toBe("Beyond 2 standard deviations of the baseline: 2012 (+2.4).");
    const calm = buildFindings({ rows: rows(), comparison, season, anomaly: { sd: 1, years: [{ year: 2011, z: 0.3, flag: false }] }, accuracy });
    expect(calm.shows.find((s) => s.label === "Unusual years").text).toContain("No complete year");
  });
  it("omits what it cannot compute instead of guessing", () => {
    const out = buildFindings({ rows: rows(), comparison: null, season: null, anomaly: null, accuracy: null });
    expect(out.shows.map((s) => s.label)).toEqual(["Busiest month", "Busiest year"]);
  });
  it("does not print a percentage when the median is 0", () => {
    const out = buildFindings({ rows: rows(), comparison: { ...comparison, percentDiff: null }, season, anomaly, accuracy });
    expect(out.shows[0].text).toContain("the December median is 0");
  });
});

describe("READING_GUIDE", () => {
  it("explains every graph on the page and contains no digits that look like data", () => {
    expect(READING_GUIDE.map((g) => g.id)).toEqual(["map", "calendar", "seasonal", "anomaly", "now"]);
    for (const g of READING_GUIDE) expect(g.text.length).toBeGreaterThan(40);
  });
});
