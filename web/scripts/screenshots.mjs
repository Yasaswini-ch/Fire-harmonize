// Takes full-page screenshots of the workbench at 1440 px and 375 px for both regions, and runs a few measurable checks on
// the page it screenshots (text size, tap-target height, horizontal overflow, console errors). Uses the installed Chrome
// through playwright-core (no browser is downloaded). Dev tool only; it is not part of the app.
//
//   Run (PowerShell, with the dev server on :5173):   node scripts/screenshots.mjs
//   Output: ../docs/screenshots/{region}-{width}.png and a printed list of findings.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const BASE = process.env.APP_URL ?? "http://localhost:5173/";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const REGIONS = [["western_na", "Western North America"], ["zambia", "Zambia"]];
const SIZES = [[1440, 900], [375, 812]];

// Everything measured inside the page.
async function audit(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    // Smallest rendered text: every element that directly holds a non-empty text node.
    const small = new Map();
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || el.closest(".landing-root")) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14) small.set(`${el.tagName.toLowerCase()}.${(el.className?.baseVal ?? el.className ?? "").toString().split(" ")[0]} "${el.textContent.trim().slice(0, 30)}"`, size);
    }
    const short = [];
    for (const el of document.querySelectorAll("button, input:not([type=hidden]), select, summary")) {
      if (!visible(el)) continue;
      const h = el.getBoundingClientRect().height;
      if (h < 43.5) short.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || el.type || "").trim().slice(0, 28)}" ${Math.round(h)}px`);
    }
    const doc = document.documentElement;
    return {
      smallText: [...small.entries()].slice(0, 25),
      shortControls: short.slice(0, 25),
      overflowX: doc.scrollWidth > doc.clientWidth + 1 ? `${doc.scrollWidth} > ${doc.clientWidth}` : null,
      calCells: document.querySelectorAll(".cal-cell:not(.none)").length,
      calYears: document.querySelectorAll(".cal-year").length,
      focusable: [...document.querySelectorAll(".cal-cell")].filter((c) => c.tabIndex === 0).length,
      docHeight: doc.scrollHeight,
    };
  });
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const findings = [];
for (const [w, h] of SIZES) {
  for (const [id, name] of REGIONS) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE, { waitUntil: "networkidle" });
    // the opening page, then into the workbench with the first region; pick the other one from the header if needed
    await page.getByRole("button", { name: "Explore the workbench" }).click();
    await page.waitForSelector(".cal", { timeout: 20000 });
    if (id !== "western_na") {
      await page.selectOption(".region-select select", { label: name });
      await page.waitForFunction((n) => document.querySelector(".area-title, .card h2")?.textContent !== undefined && document.querySelector(".region-select select")?.selectedOptions[0]?.textContent === n, name);
      await page.waitForSelector(".cal", { timeout: 20000 });
    }
    await page.waitForTimeout(1500); // the map's detections and tiles settle
    const a = await audit(page);
    findings.push({ id, w, errors, ...a });
    await page.screenshot({ path: `${OUT}${id}-${w}.png`, fullPage: true });
    await context.close();
  }
}
await browser.close();
for (const f of findings) {
  const bySize = {};
  for (const [label, size] of f.smallText) (bySize[size] ??= []).push(label);
  console.log(`
== ${f.id} @ ${f.w}px: errors ${f.errors.length}, overflowX ${f.overflowX}, calendar cells ${f.calCells}, year columns ${f.calYears}, tab stops in calendar ${f.focusable}, page height ${f.docHeight}px`);
  if (f.errors.length) console.log("  console errors:", f.errors.slice(0, 3));
  console.log("  controls under 44px:", f.shortControls.length ? f.shortControls : "none");
  console.log("  text under 14px:", Object.keys(bySize).length ? Object.entries(bySize).map(([s, l]) => `${s}px x${l.length} e.g. ${l[0]}`) : "none");
}
