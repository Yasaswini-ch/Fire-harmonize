import { describe, expect, it } from "vitest";
import { accuracyOf, chartData, TARGET_PCT } from "./accuracy.js";

const ratios = [15, 14, 8, 6, 5, 4, 4.5, 5, 6, 8, 14, 17];
const meta = (median, extra = {}) => ({
  regions: {
    zambia: {
      model: { id: "D", name: "ratio per calendar month", fitWindow: ["2012-02", "2021-12"], params: { ratios } },
      cv: {
        chosen: { aoi: { median_ape_pct: median, bias_pct: 1.5 } },
        allModels: { A: { median_ape_pct: 33.1, bias_pct: 1.5 }, D: { median_ape_pct: median, bias_pct: 1.5 } },
        byYear: { 2013: { medianApePct: 18.5, biasPct: -0.3 }, 2012: { medianApePct: 17.6, biasPct: 1.9 } },
      },
      driftDiagnostic: { aoiErrorByYearFromDriftStart: { 2023: { median_ape_pct: 19.1 }, 2022: { median_ape_pct: 32.0 } } },
      ...extra,
    },
  },
});

describe("accuracyOf", () => {
  it("reads the error, bias and model for a region", () => {
    const a = accuracyOf(meta(18.5), "zambia");
    expect(a.medianErrorPct).toBe(18.5);
    expect(a.biasPct).toBe(1.5);
    expect(a.model).toBe("ratio per calendar month");
    expect(a.fitWindow).toEqual(["2012-02", "2021-12"]);
  });
  it("is within target at or below the limit and not above it", () => {
    expect(accuracyOf(meta(TARGET_PCT), "zambia").withinTarget).toBe(true);
    expect(accuracyOf(meta(TARGET_PCT + 0.1), "zambia").withinTarget).toBe(false);
    expect(accuracyOf(meta(86), "zambia").withinTarget).toBe(false);
  });
  it("returns null when the region or its validation is missing", () => {
    expect(accuracyOf(meta(10), "other")).toBeNull();
    expect(accuracyOf({}, "zambia")).toBeNull();
    expect(accuracyOf(null, "zambia")).toBeNull();
    expect(accuracyOf({ regions: { zambia: { cv: { chosen: { aoi: {} } } } } }, "zambia")).toBeNull();
  });
});

describe("chartData", () => {
  it("lists the models and flags the chosen one", () => {
    const { models } = chartData(meta(18.5), "zambia");
    expect(models.map((m) => m.id)).toEqual(["A", "D"]);
    expect(models.find((m) => m.chosen).id).toBe("D");
  });
  it("sorts the per-year errors by year and keeps held-out and after-fit years apart", () => {
    const { byYear, afterFit } = chartData(meta(18.5), "zambia");
    expect(byYear.map((d) => d.year)).toEqual([2012, 2013]);
    expect(afterFit.map((d) => d.year)).toEqual([2022, 2023]);
    expect(afterFit[0].errorPct).toBe(32);
  });
  it("gives twelve named months for the per-month ratio model", () => {
    const { ratios: r } = chartData(meta(18.5), "zambia");
    expect(r).toHaveLength(12);
    expect(r[0]).toEqual({ month: "Jan", ratio: 15 });
    expect(r[11].month).toBe("Dec");
  });
  it("leaves out whatever meta.json does not carry instead of guessing", () => {
    const old = { regions: { western_na: { model: { id: "C", params: { offsets: [0], b: 1 } }, cv: { chosen: { aoi: { median_ape_pct: 86 } }, allModels: { C: { median_ape_pct: 86 } } } } } };
    const d = chartData(old, "western_na");
    expect(d.byYear).toEqual([]);
    expect(d.afterFit).toEqual([]);
    expect(d.ratios).toEqual([]);
    expect(d.models).toHaveLength(1);
    expect(chartData(null, "x")).toEqual({ models: [], byYear: [], afterFit: [], ratios: [] });
  });
  it("ignores a ratio list that is not twelve long", () => {
    const bad = meta(18.5);
    bad.regions.zambia.model.params.ratios = [1, 2, 3];
    expect(chartData(bad, "zambia").ratios).toEqual([]);
  });
});
