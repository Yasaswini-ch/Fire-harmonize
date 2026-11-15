import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MethodsPanel from "./MethodsPanel.jsx";

const cov = { targetPct: 80, heldOutYearsPct: 77.6, inSamplePct: 80.1, n: 1000 };
const cls = (id, label, minDeg, maxDeg, nAois, median, bias, weighted, count) => ({
  id, label, minDeg, maxDeg, nAois, medianApePct: median, biasPct: bias, countWeightedErrorPct: weighted,
  medianActualCountNonzero: count, medianActualCountAll: 5, nPairs: 500, nNonzero: 400, coverage: cov, pooledMultipliers: false,
});
const meta = {
  dataVersion: "V", generated: "G", filters: {}, snpp: {},
  regions: {
    zambia: {
      model: { id: "D", name: "ratio per calendar month", fitWindow: ["2012-02", "2021-12"], cvFolds: 10 },
      cv: { chosen: { aoi: { median_ape_pct: 18.5, bias_pct: 1.8 } } },
      modelSelection: {
        rule: "RULE-TEXT", maxAbsBiasPct: 15, chosen: "D", noneQualified: false, note: "NOTE-TEXT set after seeing results",
        candidates: [
          { model: "A", name: "ratio", medianApePct: 33.1, biasPct: 1.5, qualifies: true },
          { model: "B", name: "log1p linear", medianApePct: 51.9, biasPct: 32.3, qualifies: false },
          { model: "D", name: "ratio per calendar month", medianApePct: 18.5, biasPct: 1.8, qualifies: true },
        ],
      },
      sizeClasses: [
        cls("3-5", "3 to 5 degrees", 3, 5, 150, 17.1, 1.2, 9.4, 4200),
        cls("1-2", "1 to 2 degrees", 1, 2, 12, 31.6, 2.1, 12.8, 310),
        cls("region", "whole region", 12, 12, 1, 8.2, 0.9, 7.7, 250000),
      ],
    },
  },
};
const html = (m = meta) => renderToStaticMarkup(createElement(MethodsPanel, { meta: m, regionId: "zambia", regionName: "Zambia" }));

describe("MethodsPanel error by area size", () => {
  it("lists every size class, smallest first and the whole region last, with both error measures", () => {
    const out = html();
    expect(out.indexOf("1 to 2 degrees")).toBeLessThan(out.indexOf("3 to 5 degrees"));
    expect(out.indexOf("3 to 5 degrees")).toBeLessThan(out.indexOf("whole region"));
    for (const s of ["31.6%", "12.8%", "17.1%", "9.4%", "8.2%", "7.7%", "Median error", "Count-weighted error", "Median monthly count", "250,000", "78%"]) {
      expect(out).toContain(s);
    }
  });
  it("compares the whole region with the smallest areas using numbers from meta.json, and says smaller areas are less certain", () => {
    const out = html();
    expect(out).toContain("Region-wide, an estimated month is typically off by 8.2%");
    expect(out).toContain("for areas of 1 to 2 degrees it is 31.6%");
    expect(out).toContain("Small areas are less certain than the region as a whole.");
  });
  it("does not claim small areas are less certain when the numbers say otherwise", () => {
    const flipped = structuredClone(meta);
    flipped.regions.zambia.sizeClasses.find((c) => c.id === "region").medianApePct = 40;
    const out = html(flipped);
    expect(out).toContain("Region-wide, an estimated month is typically off by 40.0%");
    expect(out).not.toContain("Small areas are less certain");
  });
  it("omits the comparison when a number is missing, and shows 'not in meta.json' in the table", () => {
    const partial = structuredClone(meta);
    partial.regions.zambia.sizeClasses.find((c) => c.id === "region").medianApePct = null;
    const out = html(partial);
    expect(out).not.toContain("Region-wide, an estimated month");
    expect(out).toContain("not in meta.json");
  });
  it("has no size table for an older export without size classes", () => {
    const old = structuredClone(meta);
    delete old.regions.zambia.sizeClasses;
    expect(html(old)).not.toContain("Error by area size");
  });
});

describe("MethodsPanel model selection", () => {
  it("shows the rule, the candidates with error and bias, and the note, all from meta.json", () => {
    const out = html();
    for (const s of ["RULE-TEXT", "NOTE-TEXT set after seeing results", "33.1%", "51.9%", "32.3%", "ratio per calendar month (used)"]) {
      expect(out).toContain(s);
    }
  });
  it("warns loudly when no model met the bias limit", () => {
    const none = structuredClone(meta);
    none.regions.zambia.modelSelection.noneQualified = true;
    expect(html(none)).toContain("No candidate model met the bias limit");
  });
});
