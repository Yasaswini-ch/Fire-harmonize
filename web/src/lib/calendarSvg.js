// The calendar drawn as a standalone SVG string, for "Download image". The on-screen calendar is HTML and CSS, which an
// exported image cannot use, so this redraws the same model with the same rules: viridis colour, a diagonal line
// overlay on estimated cells, dots on provisional ones, a white line where the source changes, a pink outline on the five
// highest months, an accent bar on fire-season month labels. Pure: model in, string out.
import { interpolateViridis } from "d3-scale-chromatic";
import { MONTHS } from "./format.js";

const FONT = "system-ui, 'Segoe UI', Roboto, Arial, sans-serif";
const INK = "#f4efe5";
const MUTED = "#aab2c0";
const ACCENT = "#f0b84a";
const PINK = "#ff5fa2";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const compact = (v) => v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const PATTERN_DEFS =
  '<defs>'
  + '<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="1" x2="7" y2="1" stroke="#fff" stroke-opacity="0.28" stroke-width="2"/></pattern>'
  + '<pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.3" fill="#fff" fill-opacity="0.7"/></pattern>'
  + '</defs>';

const text = (x, y, s, size, { weight = 400, fill = INK, anchor = "start", rotate } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"`
  + `${rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : ""}>${esc(s)}</text>`;

export function buildCalendarSvg(model, { cellW = 26, cellH = 24, gap = 2 } = {}) {
  const LABEL = 56;
  const MEDIAN = model.hasMedian ? 56 : 0;
  const BRACKET = 44;
  const YEARS = 50;
  const TOTAL = 74;
  const n = model.years.length;
  const gridW = n * cellW + (n - 1) * gap;
  const W = LABEL + gap + gridW + (MEDIAN ? gap + MEDIAN : 0);
  const rowsTop = BRACKET + YEARS;
  const H = rowsTop + 12 * (cellH + gap) + TOTAL;
  const colX = (c) => LABEL + gap + c * (cellW + gap);
  let out = PATTERN_DEFS;

  // brackets and year labels
  const bracket = (b, strong) => {
    if (!b) return "";
    const x0 = colX(b.startCol);
    const x1 = colX(b.startCol + b.span - 1) + cellW;
    const colour = strong ? INK : MUTED;
    return `<line x1="${x0}" y1="${BRACKET - 6}" x2="${x1}" y2="${BRACKET - 6}" stroke="${colour}" stroke-width="${strong ? 3 : 2}"/>`
      + text((x0 + x1) / 2, BRACKET - 14, `${strong ? "VIIRS native" : "MODIS-estimated"} · ${b.from} to ${b.to}`, 13, { anchor: "middle", fill: colour, weight: strong ? 600 : 400 });
  };
  out += bracket(model.spans.estimated, false) + bracket(model.spans.native, true);
  model.years.forEach((y, c) => { out += text(colX(c) + cellW / 2 + 5, BRACKET + YEARS - 4, y, 13, { anchor: "start", rotate: -90 }); });
  if (MEDIAN) out += text(LABEL + gap + gridW + gap + MEDIAN / 2, BRACKET + YEARS - 8, "Median", 13, { anchor: "middle", fill: MUTED });

  // month rows
  model.months.forEach((m, mi) => {
    const y = rowsTop + mi * (cellH + gap);
    out += `<rect x="0" y="${y}" width="3" height="${cellH}" fill="${m.inSeason ? ACCENT : "none"}"/>`;
    out += text(10, y + cellH - 7, MONTHS[mi], 14, { fill: m.inSeason ? ACCENT : INK, weight: m.inSeason ? 700 : 400 });
    m.cells.forEach((c, col) => {
      const x = colX(col);
      if (!c) {
        out += `<rect x="${x + 0.5}" y="${y + 0.5}" width="${cellW - 1}" height="${cellH - 1}" fill="none" stroke="#4a5160" stroke-dasharray="3 3"/>`;
        return;
      }
      out += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="${interpolateViridis(c.t)}"/>`;
      if (c.status === "estimated") out += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="url(#hatch)"/>`;
      if (c.status === "provisional") out += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="url(#dots)"/>`;
      if (c.edgeLeft) out += `<rect x="${x}" y="${y}" width="2" height="${cellH}" fill="#fff"/>`;
      if (c.edgeTop) out += `<rect x="${x}" y="${y}" width="${cellW}" height="2" fill="#fff"/>`;
      if (c.top5) out += `<rect x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" fill="none" stroke="${PINK}" stroke-width="2"/>`;
    });
    if (MEDIAN) out += text(LABEL + gap + gridW + gap + MEDIAN / 2, y + cellH - 7, m.median === null ? "n/a" : compact(m.median), 13, { anchor: "middle", fill: MUTED });
  });

  // annual totals under each year
  const ty = rowsTop + 12 * (cellH + gap) + 8;
  out += text(10, ty + 14, "Total", 13, { fill: MUTED });
  model.totals.forEach((t, c) => {
    out += text(colX(c) + cellW / 2 + 5, ty + TOTAL - 14, `${compact(t.total)}${t.partial ? " part." : ""}`, 12, { fill: MUTED, rotate: -90 });
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}</svg>`;
  return { svg, width: W, height: H };
}
