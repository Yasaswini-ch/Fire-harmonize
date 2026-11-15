// Computes, with the web app's own library code, every number and sentence the PDF report shows, and writes
// data/interim/report_{region}.json for pipeline/06_report_pdf.py. Using the same code as the app means the PDF
// and the screen cannot disagree. The report covers the whole region over the full record.
//   node scripts/report_data.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { regionAoi } from "../src/lib/aoi.js";
import { accuracyOf } from "../src/lib/accuracy.js";
import { aggregateSeries } from "../src/lib/aggregate.js";
import { buildCalendarModel } from "../src/lib/calendarModel.js";
import { buildFindings, READING_GUIDE } from "../src/lib/findings.js";
import { METHOD_CHOICES, METHOD_PARAGRAPH } from "../src/lib/methodText.js";
import { annualTotals, anomalyZ, baselineYearCount, currentMonthComparison, fireSeasonWindow, monthlyMedianBaseline, topMonths, topYears, yearOf } from "../src/lib/stats.js";

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, "..", "public", "data");
const out = join(here, "..", "..", "data", "interim");
const read = (name) => JSON.parse(readFileSync(join(pub, name), "utf-8"));

const regions = read("regions.json");
const meta = read("meta.json");
mkdirSync(out, { recursive: true });

for (const region of regions) {
  const d = read(`cells_${region.id}.json`);
  const cellsData = { ...d, cellSize: region.cellSize, loMult: region.lo_mult, hiMult: region.hi_mult, bbox: region.bbox, sizeClasses: region.sizeClasses ?? null };
  const aoi = regionAoi(region); // the whole region, as the app's "Full region" button
  const rows = aggregateSeries(cellsData, aoi);

  const complete = annualTotals(rows).map((t) => t.year);
  const excludeYear = yearOf(rows[rows.length - 1].month);
  const baseline = monthlyMedianBaseline(rows, complete[0], complete[complete.length - 1], excludeYear);
  const season = fireSeasonWindow(rows, complete[0], complete[complete.length - 1], excludeYear);
  const comparison = currentMonthComparison(rows, baseline);
  const anomaly = anomalyZ(rows, complete[0], complete[complete.length - 1], rows);
  const accuracy = accuracyOf(meta, region.id);
  const model = buildCalendarModel({ rows, baseline, season, log: true });
  const total = rows.reduce((a, r) => a + r.count, 0);

  const report = {
    region: { id: region.id, name: region.name, bbox: region.bbox },
    dataVersion: meta.dataVersion ?? null, generated: meta.generated ?? null,
    rows, baseline, baselineYears: baselineYearCount(baseline), baselineRange: [complete[0], complete[complete.length - 1]],
    season, comparison, anomaly, accuracy, calendar: model,
    total, estimatedMonths: rows.filter((r) => r.source === "modis_estimated").length,
    topMonths: topMonths(rows, 5), topYears: topYears(rows, 5),
    findings: buildFindings({ rows, comparison, season, anomaly, accuracy }),
    guide: READING_GUIDE, methodParagraph: METHOD_PARAGRAPH, methodChoices: METHOD_CHOICES,
  };
  writeFileSync(join(out, `report_${region.id}.json`), JSON.stringify(report), "utf-8");
  console.log(`${region.id}: ${rows.length} months, ${Math.round(total)} detections, baseline ${report.baselineYears} years`);
}
