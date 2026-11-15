import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCells, loadMeta, loadRegions } from "./data.js";

const ok = (body) => ({ ok: true, status: 200, statusText: "OK", json: async () => body });
const region = { id: "r1", name: "R1", bbox: [0, 0, 1, 1], cellSize: 0.25, lo_mult: Array(12).fill(1), hi_mult: Array(12).fill(1) };
const stub = (fn) => vi.stubGlobal("fetch", fn);
afterEach(() => vi.unstubAllGlobals());

describe("data loading names the failing file", () => {
  it("loads regions and checks they are usable", async () => {
    stub(async () => ok([region]));
    expect(await loadRegions()).toEqual([region]);
    stub(async () => ok([{ id: "x", bbox: [0, 0, 1, 1] }]));
    await expect(loadRegions()).rejects.toThrow(/regions\.json: region x is missing/);
  });
  it("reports HTTP errors with the path", async () => {
    stub(async () => ({ ok: false, status: 404, statusText: "Not Found" }));
    await expect(loadMeta()).rejects.toThrow("Could not load /data/meta.json: HTTP 404 Not Found");
  });
  it("reports network failures with the path", async () => {
    stub(async () => { throw new TypeError("Failed to fetch"); });
    await expect(loadRegions()).rejects.toThrow("Could not load /data/regions.json: Failed to fetch");
  });
  it("reports non-JSON bodies (e.g. an HTML fallback page) with the path", async () => {
    stub(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => { throw new SyntaxError("Unexpected token <"); } }));
    await expect(loadCells(region)).rejects.toThrow(/\/data\/cells_r1\.json is not valid JSON/);
  });
  it("rejects cells files whose arrays are not aligned with the months", async () => {
    stub(async () => ok({ months: ["2020-01", "2020-02"], firstViirsIndex: 0, provisionalFrom: 2, cells: [{ lat: 0, lon: 0, v: [1] }] }));
    await expect(loadCells(region)).rejects.toThrow(/cells_r1\.json: a cell's values are not aligned/);
  });
  it("adds the region multipliers and cell size to the cells payload", async () => {
    stub(async () => ok({ months: ["2020-01"], firstViirsIndex: 0, provisionalFrom: 1, cells: [{ lat: 0, lon: 0, v: [1] }] }));
    const d = await loadCells(region);
    expect(d.cellSize).toBe(0.25);
    expect(d.loMult).toHaveLength(12);
  });
});
