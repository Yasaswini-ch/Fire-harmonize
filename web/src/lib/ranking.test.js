import { describe, expect, it } from "vitest";
import { leaderText, rankingOf, topFiveText } from "./ranking.js";
import { hasUncertainty, prepare, rng, simulate } from "./uncertainty.js";

const months = [];
for (let y = 2010; y <= 2013; y++) for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
const FV = months.indexOf("2012-02");
// Observed months of 100; one big observed month (2012-08, 1000) and one estimated month nearly as big (2011-08, 900, range 720 to 1125).
// By hand: sigma = ln(1125/720) / (2 x 1.2816) = 0.174, so a draw beats 1000 with probability about 0.27 (z = ln(1000/900) / 0.174 = 0.60),
// and the observed month should lead in roughly 73 percent of draws.
const rows = (over = {}) => months.map((month, i) => {
  const est = i < FV;
  const count = month === "2012-08" ? 1000 : month === "2011-08" ? 900 : 100;
  const r = { month, count, lo: est ? count * 0.8 : count, hi: est ? count * 1.25 : count, source: est ? "modis_estimated" : "viirs_native", provisional: false };
  return { ...r, ...(over[month] ?? {}) };
});

describe("simulate", () => {
  it("leaves observed months exactly as they are", () => {
    const prep = prepare(rows());
    const v = simulate(prep, rng(1), false);
    expect(v[FV + 6]).toBe(1000);
    expect(v[FV + 7]).toBe(100);
  });
  it("draws estimated months so about 80 percent land inside their stated range", () => {
    const r = rows({ "2010-05": { count: 200, lo: 100, hi: 400 } });
    const prep = prepare(r);
    const rand = rng(9);
    const i = months.indexOf("2010-05");
    let inside = 0;
    for (let d = 0; d < 4000; d++) { const x = simulate(prep, rand, false)[i]; if (x >= 100 && x <= 400) inside++; }
    expect(inside / 4000).toBeGreaterThan(0.77);
    expect(inside / 4000).toBeLessThan(0.83);
  });
  it("makes estimated months move together when asked to", () => {
    const prep = prepare(rows());
    const v = simulate(prep, rng(3), true);
    const z = (i) => Math.log(v[i] / Math.sqrt(prep[i].mu ? Math.exp(2 * prep[i].mu) : 1)) / prep[i].sigma;
    expect(z(0)).toBeCloseTo(z(5), 6);
  });
  it("is deterministic for a seed", () => {
    const prep = prepare(rows());
    expect([...simulate(prep, rng(5), false)]).toEqual([...simulate(prep, rng(5), false)]);
  });
  it("draws a month estimated as zero between 0 and the top of its range", () => {
    const prep = prepare([{ month: "2010-01", count: 0, lo: 0, hi: 30, source: "modis_estimated", provisional: false }]);
    expect(prep[0].kind).toBe(2);
    const x = simulate(prep, rng(2), false)[0];
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(30);
  });
  it("sees no uncertainty when every month is observed", () => {
    expect(hasUncertainty(prepare(rows().slice(FV)))).toBe(false);
  });
});

describe("rankingOf", () => {
  const out = rankingOf(rows());
  it("says the ranking is exact when no month in the range is estimated", () => {
    expect(rankingOf(rows().slice(FV))).toEqual({ uncertain: false });
    expect(rankingOf([])).toBeNull();
  });
  it("puts the observed busiest month first, with the estimated runner-up behind it", () => {
    expect(out.uncertain).toBe(true);
    expect(out.month[0].month).toBe("2012-08");
    expect(out.month[0].pHigh).toBeGreaterThan(0.68);
    expect(out.month[0].pHigh).toBeLessThan(0.78);
    expect(out.month[1].month).toBe("2011-08");
    expect(out.month[1].pHigh).toBeGreaterThan(0.2);
    // each pLow is the smaller of the two assumptions' chances, so the lows cannot add up to more than one draw's worth
    expect(out.month.reduce((t, c) => t + c.pLow, 0)).toBeLessThanOrEqual(1.0001);
  });
  it("gives a low and a high chance, the two assumptions bracketing it", () => {
    for (const c of [...out.month, ...out.year, ...out.topFive]) expect(c.pLow).toBeLessThanOrEqual(c.pHigh);
  });
  it("ranks complete years and lists the chance of each top-five month", () => {
    expect(out.year.map((c) => c.year)).toContain(2012);
    expect(out.topFive).toHaveLength(5);
    expect(out.topFive[0]).toMatchObject({ month: "2012-08" });
    expect(out.topFive[0].pLow).toBeGreaterThan(0.99);
  });
  it("is the same every time", () => {
    expect(rankingOf(rows())).toEqual(out);
  });
  it("is certain when no estimated month is anywhere near the top", () => {
    const calm = rows({ "2011-08": { count: 90, lo: 72, hi: 112 } });
    const r = rankingOf(calm);
    expect(r.month[0]).toMatchObject({ month: "2012-08", pLow: 1, pHigh: 1 });
    expect(leaderText(r.month, "month", (c) => c.month)).toBe("No estimated month comes close enough to change this.");
  });
});

describe("texts", () => {
  const fake = [{ month: "2012-08", pLow: 0.62, pHigh: 0.71 }, { month: "2011-08", pLow: 0.2, pHigh: 0.24 }];
  it("states the chance as a range between the two assumptions, with the runner-up", () => {
    expect(leaderText(fake, "month", (c) => c.month)).toBe("2012-08 is the busiest month in 62% to 71% of draws within the stated ranges; next is 2011-08 (20% to 24%).");
  });
  it("gives a single figure when the assumptions agree", () => {
    expect(leaderText([{ year: 2012, pLow: 0.7, pHigh: 0.7 }], "year", (c) => String(c.year))).toContain("in 70% of draws");
  });
  it("lists only the shaky members of the top five", () => {
    const t = topFiveText([{ month: "2012-08", pLow: 1, pHigh: 1 }, { month: "2008-09", pLow: 0.64, pHigh: 0.8 }]);
    expect(t).toContain("September 2008 64% to 80%");
    expect(t).not.toContain("August 2012");
    expect(topFiveText([{ month: "2012-08", pLow: 1, pHigh: 1 }])).toBeNull();
  });
  it("says nothing without candidates", () => {
    expect(leaderText([], "month", String)).toBeNull();
    expect(leaderText(undefined, "year", String)).toBeNull();
  });
});
