import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import SyntheticBanner from "../components/SyntheticBanner.jsx";
import { checkMeta, isSynthetic, SYNTHETIC_BANNER_TEXT } from "./synthetic.js";

const script = fileURLToPath(new URL("../../scripts/check-synthetic.mjs", import.meta.url));
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf-8"));

describe("isSynthetic", () => {
  it("is false only for a missing key or an explicit false", () => {
    expect(isSynthetic({ synthetic: false })).toBe(false);
    expect(isSynthetic({})).toBe(false);
    expect(isSynthetic(null)).toBe(false);
    expect(isSynthetic(undefined)).toBe(false);
  });
  it("is true for true and for any sloppy truthy-looking value", () => {
    for (const v of [true, "true", "false", 1, 0, "", "yes", null]) expect(isSynthetic({ synthetic: v })).toBe(true);
  });
});

describe("checkMeta", () => {
  it("passes real data", () => {
    expect(checkMeta({ synthetic: false }, {})).toEqual({ ok: true, message: null });
    expect(checkMeta({}, {})).toEqual({ ok: true, message: null });
  });
  it("blocks synthetic data with a message that says why and how to override", () => {
    const r = checkMeta({ synthetic: true }, {});
    expect(r.ok).toBe(false);
    expect(r.message).toContain("BUILD BLOCKED");
    expect(r.message).toContain('"synthetic": true');
    expect(r.message).toContain("ALLOW_SYNTHETIC=1");
    expect(r.message).toContain("04_export.py");
  });
  it("lets ALLOW_SYNTHETIC=1 through with a loud warning, and nothing weaker", () => {
    const r = checkMeta({ synthetic: true }, { ALLOW_SYNTHETIC: "1" });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("WARNING");
    expect(r.message).toContain("SYNTHETIC TEST DATA");
    for (const v of ["0", "", "true", "yes", "11", undefined]) expect(checkMeta({ synthetic: true }, { ALLOW_SYNTHETIC: v }).ok).toBe(false);
  });
});

describe("check-synthetic script (what `npm run build` runs first)", () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "synthetic-guard-")); });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function run(content, allow) {
    const file = join(dir, "meta.json");
    if (content !== null) writeFileSync(file, content, "utf-8");
    const env = { ...process.env };
    delete env.ALLOW_SYNTHETIC;
    if (allow !== undefined) env.ALLOW_SYNTHETIC = allow;
    return spawnSync(process.execPath, [script, join(dir, content === null ? "missing.json" : "meta.json")], { env, encoding: "utf-8" });
  }

  it("exits 1 with a clear message when meta.json is synthetic", () => {
    const r = run('{"synthetic": true}');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("BUILD BLOCKED");
    expect(r.stderr).toContain("ALLOW_SYNTHETIC=1");
  });
  it("exits 0 with a warning when ALLOW_SYNTHETIC=1", () => {
    const r = run('{"synthetic": true}', "1");
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("WARNING");
  });
  it("exits 1 for any other ALLOW_SYNTHETIC value", () => {
    expect(run('{"synthetic": true}', "true").status).toBe(1);
    expect(run('{"synthetic": true}', "0").status).toBe(1);
  });
  it("exits 0 silently for real data", () => {
    const r = run('{"synthetic": false, "dataVersion": "x"}');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });
  it("exits 1 when meta.json is unreadable, because it cannot be checked", () => {
    expect(run("{ not json").status).toBe(1);
    expect(run("[1, 2]").status).toBe(1);
    expect(run("null").status).toBe(1);
  });
  it("warns but passes when there is no meta.json at all", () => {
    const r = run(null);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("not found");
  });
  it("is wired in as the prebuild step, so npm run build cannot skip it", () => {
    expect(packageJson.scripts.prebuild).toBe("node scripts/check-synthetic.mjs");
    expect(packageJson.scripts.build).toMatch(/^vite build/);
  });
});

describe("SyntheticBanner", () => {
  it("shows the exact warning, as an alert, when meta is synthetic", () => {
    const out = renderToStaticMarkup(createElement(SyntheticBanner, { meta: { synthetic: true } }));
    expect(out).toContain(`>${SYNTHETIC_BANNER_TEXT}<`);
    expect(SYNTHETIC_BANNER_TEXT).toBe("SYNTHETIC TEST DATA, NOT REAL FIRE DATA");
    expect(out).toContain('role="alert"');
  });
  it("renders nothing for real data", () => {
    expect(renderToStaticMarkup(createElement(SyntheticBanner, { meta: { synthetic: false } }))).toBe("");
    expect(renderToStaticMarkup(createElement(SyntheticBanner, { meta: {} }))).toBe("");
  });
});
