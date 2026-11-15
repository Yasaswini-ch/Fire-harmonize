// The burning activity calendar as data: years across the top, twelve months down the side. Pure, no React, so the
// rules that matter (which cell is estimated, where the source changes, which months are the top five, which years
// are partial) can be tested. Every year, label and edge is derived from the rows; nothing is hardcoded.
import { cellLabel, MONTHS, MONTH_NAMES } from "./format.js";
import { topMonths } from "./stats.js";

const yearOf = (m) => Number(m.slice(0, 4));
const monthIdx = (m) => Number(m.slice(5, 7)) - 1;
const key = (y, mi) => `${y}-${mi}`;

export const statusOf = (r) => (r.provisional ? "provisional" : r.source === "modis_estimated" ? "estimated" : "native");

// rows: [{ month: "YYYY-MM", count, lo, hi, source, provisional }] in time order (the selected range).
// baseline: monthlyMedianBaseline output (12 entries with median and n) or null. season: fireSeasonWindow output or null.
// log: colour on a log scale (log of count + 1) when true, linear otherwise.
export function buildCalendarModel({ rows, baseline = null, season = null, log = true }) {
  const y0 = yearOf(rows[0].month);
  const y1 = yearOf(rows[rows.length - 1].month);
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const byKey = new Map(rows.map((r) => [key(yearOf(r.month), monthIdx(r.month)), r]));

  const counts = rows.map((r) => r.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const f = log ? Math.log1p : (x) => x;
  const t = (c) => (max === min ? 0 : (f(c) - f(min)) / (f(max) - f(min)));

  const top5 = new Set(topMonths(rows, 5).map((r) => key(yearOf(r.month), monthIdx(r.month))));
  const status = (y, mi) => {
    const r = byKey.get(key(y, mi));
    return r ? statusOf(r) : null;
  };

  const estYearSet = rows.filter((r) => statusOf(r) === "estimated").map((r) => yearOf(r.month));
  const estimatedBefore = (y) => estYearSet.some((ey) => ey < y);

  const monthRows = MONTHS.map((name, mi) => {
    let seenNative = false; // has an earlier cell in this row already been VIIRS-native?
    const cells = years.map((y, col) => {
      const r = byKey.get(key(y, mi));
      if (!r) return null;
      const st = statusOf(r);
      const native = st !== "estimated";
      // The source-change line sits on the first native cell of each month row, as long as the record has estimated
      // months before it (even if this particular row has no earlier cell, because the record starts mid-year).
      const edgeLeft = native && !seenNative && estimatedBefore(y);
      const edgeTop = native && mi > 0 && status(y, mi - 1) === "estimated";
      if (native) seenNative = true;
      const isTop = top5.has(key(y, mi));
      return {
        key: key(y, mi), year: y, monthIndex: mi, col, month: r.month, count: r.count, lo: r.lo, hi: r.hi, status: st,
        t: t(r.count), edgeLeft, edgeTop, top5: isTop,
        label: cellLabel(r) + (isTop ? ", one of the five highest months in this range" : ""),
      };
    });
    return {
      index: mi, name, fullName: MONTH_NAMES[mi], inSeason: Boolean(season?.months.includes(mi + 1)),
      median: baseline && baseline[mi]?.n > 0 ? baseline[mi].median : null, cells,
    };
  });

  // Brackets over the columns: estimated years are those before the first VIIRS-native month.
  const native = rows.filter((r) => statusOf(r) !== "estimated");
  const firstNativeYear = native.length ? yearOf(native[0].month) : null;
  const estYears = years.filter((y) => (firstNativeYear === null || y < firstNativeYear) && rows.some((r) => yearOf(r.month) === y && statusOf(r) === "estimated"));
  const spans = {
    estimated: estYears.length ? { from: estYears[0], to: estYears[estYears.length - 1], startCol: years.indexOf(estYears[0]), span: estYears.length } : null,
    native: firstNativeYear !== null
      ? { from: firstNativeYear, to: y1, startCol: years.indexOf(firstNativeYear), span: y1 - firstNativeYear + 1 } : null,
  };

  const totals = years.map((y) => {
    const inYear = rows.filter((r) => yearOf(r.month) === y);
    return { year: y, total: inYear.reduce((a, r) => a + r.count, 0), months: inYear.length, partial: inYear.length < 12 };
  });

  return {
    years, months: monthRows, min, max, log, spans, totals,
    scaleLabel: log ? "Log scale" : "Linear scale",
    hasMedian: monthRows.some((m) => m.median !== null),
  };
}
