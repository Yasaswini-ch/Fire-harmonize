import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MethodsPanel from "./MethodsPanel.jsx";

const mask = { recall_pct: 81.67, false_drop_pct: 0.027, net_monthly_bias_pct: { median: 0.009, min: -5.0, max: 6.349 } };
const meta = (validation) => ({
  dataVersion: "V", generated: "G", filters: {}, snpp: {},
  staticMaskValidation: validation,
  regions: { z: { model: { name: "m", fitWindow: ["2012-02", "2021-12"] }, cv: { chosen: { aoi: { median_ape_pct: 1, bias_pct: 1 } } }, staticMask: { sp_viirs_type_nonzero_rows: 10, sp_viirs_rows: 1000 } } },
});
const html = (m) => renderToStaticMarkup(createElement(MethodsPanel, { meta: m, regionId: "z", regionName: "Z" }));

describe("MethodsPanel static-source mask test", () => {
  it("shows the measured recall, false-drop and monthly bias for the region, from meta.json", () => {
    const out = html(meta({ regions: { z: { exact: mask } } }));
    expect(out).toContain("removes 81.7% of the static sources");
    expect(out).toContain("falsely removes 0.03% of real vegetation fires");
    expect(out).toContain("median of 0.0%");
    expect(out).toContain("between -5.0% and 6.3%");
  });
  it("says the mask has not been validated when the region has no test", () => {
    expect(html(meta({ regions: { other: { exact: mask } } }))).toContain("The mask has not been validated for this region.");
    expect(html(meta(undefined))).toContain("The mask has not been validated for this region.");
  });
});
