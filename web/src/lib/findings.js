// The plain-language summary at the top of the workbench: what was done, what it shows for this area, and how to read each
// graph. Pure, no React. Every number in the "did" and "shows" sentences is computed from the rows on screen or read from
// meta.json (through accuracyOf); nothing is typed in. The reading guide explains the graphs and contains no data.
import { TARGET_PCT } from "./accuracy.js";
import { fmt, fmtPct, MONTH_NAMES, monthLabel } from "./format.js";
import { topMonths, topYears } from "./stats.js";

export const READING_GUIDE = [
  { id: "map", title: "The map",
    text: "Each square is one grid cell with detections in the month on the slider. Brighter means more. Drag the slider to move through time." },
  { id: "calendar", title: "The calendar",
    text: "Years run across and months down. Brighter is more detections. Diagonal lines are months estimated from MODIS, dots are provisional months, the white line is where VIIRS observations begin, and pink outlines are the five highest months." },
  { id: "seasonal", title: "Seasonal profile",
    text: "Grey bars are the typical (median) detections in each calendar month over the baseline years. Gold bars are the year you pick, so you can see whether it ran early, late, high or low." },
  { id: "anomaly", title: "Annual anomaly",
    text: "How far each complete year is from the baseline average, in standard deviations. A bar beyond the dashed lines, past 2 in either direction, is an unusual year." },
  { id: "now", title: "Now vs normal",
    text: "The latest month compared with the median of the same calendar month in the baseline years, with its percentile. A provisional month may still change." },
];

// rows: the monthly series in range. comparison: currentMonthComparison output or null. season: fireSeasonWindow output or null.
// anomaly: anomalyZ output or null. accuracy: accuracyOf output or null.
export function buildFindings({ rows, comparison, season, anomaly, accuracy }) {
  const n = rows.length;
  const est = rows.filter((r) => r.source === "modis_estimated").length;
  const prov = rows.filter((r) => r.provisional).length;

  const did = [
    "NASA FIRMS records fire hotspots from two families of satellites. MODIS has the long record; VIIRS sees smaller fires, so it counts more of them.",
    est > 0
      ? `We put both on one VIIRS-equivalent scale. ${est} of the ${n} months in this range come from before VIIRS and are model estimates, shown with a range.`
      : `All ${n} months in this range are VIIRS observations, so none had to be estimated.`,
  ];
  if (accuracy) {
    const fit = accuracy.fitWindow ? `, fitted on ${accuracy.fitWindow[0]} to ${accuracy.fitWindow[1]}` : "";
    did.push(
      `The model: ${accuracy.model ?? "a statistical model"}${fit}. Leaving each year out in turn, a typical estimated month was off by ${Math.round(accuracy.medianErrorPct)}%, `
      + `${accuracy.withinTarget ? "within" : "above"} our ${TARGET_PCT}% target.`,
    );
  }
  if (prov > 0) did.push(`The latest ${prov} ${prov === 1 ? "month is" : "months are"} provisional (near real time) and may still change.`);

  const shows = [];
  const c = comparison;
  if (c && c.label !== null) {
    const calMonth = MONTH_NAMES[Number(c.month.slice(5, 7)) - 1];
    const rank = c.yearsBelow == null ? ""
      : c.yearsBelow === 0 ? ` That is lower than every one of the ${c.baselineYears} baseline ${calMonth}s.`
      : c.yearsBelow === c.baselineYears ? ` That is higher than every one of the ${c.baselineYears} baseline ${calMonth}s.`
      : ` That is higher than ${c.yearsBelow} of the ${c.baselineYears} baseline ${calMonth}s.`;
    shows.push({
      label: "Now vs normal",
      text: c.percentDiff === null
        ? `${monthLabel(c.month)} has ${fmt(c.count)} detections; the ${calMonth} median is 0, so there is no percentage.`
        : `${monthLabel(c.month)} has ${fmt(c.count)} detections, ${fmtPct(c.percentDiff)} against the median for ${calMonth}${c.provisional ? " (provisional)" : ""}.${rank}`,
    });
  }
  const pm = topMonths(rows, 1)[0];
  if (pm) shows.push({ label: "Busiest month", text: `${monthLabel(pm.month)}, with ${fmt(pm.count)} detections.` });
  const py = topYears(rows, 1)[0];
  if (py) shows.push({ label: "Busiest year", text: `${py.year}, with ${fmt(py.total)} detections (complete years only).` });
  if (season) {
    const first = MONTH_NAMES[season.months[0] - 1];
    const last = MONTH_NAMES[season.months[season.length - 1] - 1];
    shows.push({
      label: "Fire season",
      text: `${season.length > 1 ? `${first} to ${last}` : first} (${season.length} ${season.length === 1 ? "month" : "months"}) holds ${Math.round(season.share * 100)}% of the typical annual total. The peak month is ${MONTH_NAMES[season.peakMonth - 1]}.`,
    });
  }
  if (anomaly && anomaly.sd !== null && anomaly.years.length > 0) {
    const flagged = anomaly.years.filter((y) => y.flag);
    shows.push({
      label: "Unusual years",
      text: flagged.length === 0
        ? "No complete year is beyond 2 standard deviations of the baseline."
        : `Beyond 2 standard deviations of the baseline: ${flagged.map((y) => `${y.year} (${y.z > 0 ? "+" : ""}${y.z.toFixed(1)})`).join(", ")}.`,
    });
  }
  return { did, shows };
}
