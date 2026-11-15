import { describe, expect, it } from "vitest";
import { urlsToCache } from "./offline.js";

const manifest = {
  "index.html": { file: "assets/index-abc.js", css: ["assets/index-abc.css"], assets: ["assets/sprite-1.svg"] },
  "src/components/GlobeView.jsx": { file: "assets/GlobeView-def.js", imports: ["index.html"] },
  "world-atlas/countries-50m.json": { file: "assets/countries-50m-ghi.js" },
};
const regions = [{ id: "western_na" }, { id: "zambia" }];

describe("urlsToCache", () => {
  it("includes the app shell, every built file, the stylesheet and the data", () => {
    const urls = urlsToCache(manifest, regions, "/");
    for (const u of ["/", "/assets/index-abc.js", "/assets/index-abc.css", "/assets/sprite-1.svg", "/assets/GlobeView-def.js",
      "/assets/countries-50m-ghi.js", "/data/regions.json", "/data/meta.json", "/data/cells_western_na.json", "/data/cells_zambia.json",
      "/globe/earth.jpg", "/manifest.webmanifest"]) expect(urls).toContain(u);
  });
  it("respects a base path", () => {
    const urls = urlsToCache(manifest, regions, "/fire-harmonize/");
    expect(urls).toContain("/fire-harmonize/assets/index-abc.js");
    expect(urls).toContain("/fire-harmonize/data/cells_zambia.json");
    expect(urls.every((u) => u.startsWith("/fire-harmonize/"))).toBe(true);
  });
  it("lists each file once", () => {
    const urls = urlsToCache({ a: { file: "assets/x.js" }, b: { file: "assets/x.js" } }, [], "/");
    expect(urls.filter((u) => u === "/assets/x.js")).toHaveLength(1);
  });
  it("copes with a missing manifest or region list", () => {
    expect(urlsToCache(null, null, "/")).toContain("/data/meta.json");
  });
});
