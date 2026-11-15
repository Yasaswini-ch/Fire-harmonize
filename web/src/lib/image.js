// PNG export of one chart: take the chart's live <svg>, wrap it with a title, AOI, date range and a drawn
// legend, and rasterise it. No dependencies. Recharts legends are HTML, so the legend is redrawn here.
import { downloadBlob } from "./download.js";

const FONT = "system-ui, 'Segoe UI', Roboto, Arial, sans-serif";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = (x, y, s, size, weight = 400, fill = "#f4f7fb") =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;

// True for a chart that is on the page now. An element made by DOMParser is "connected" to its own parsed document, which
// is not the page, so isConnected alone would wrongly treat it as live and measure it as 0 x 0.
const isLive = (el) => el.isConnected && el.ownerDocument === document;

// Copy resolved text styles into attributes: the exported SVG has no access to the page's CSS.
function inlineCopy(svgEl) {
  const clone = svgEl.cloneNode(true);
  if (!isLive(svgEl)) return clone; // a SVG built in memory already carries its own fills and fonts
  const from = svgEl.querySelectorAll("text");
  clone.querySelectorAll("text").forEach((t, i) => {
    const cs = getComputedStyle(from[i]);
    t.setAttribute("fill", cs.fill);
    t.setAttribute("font-size", cs.fontSize);
    t.setAttribute("font-weight", cs.fontWeight);
    t.setAttribute("font-family", FONT);
  });
  return clone;
}

// Legend items: { kind: "swatch", fill, label } | { kind: "line", stroke, dash, label } | { kind: "ramp", stops, min, max, note }
function legendSvg(items, width, y0) {
  let x = 0, y = y0, out = "";
  const rowH = 28;
  for (const it of items) {
    if (it.kind === "ramp") {
      if (x > 0) { x = 0; y += rowH; }
      const stops = it.stops.map((c, i) => `<stop offset="${(i / (it.stops.length - 1)) * 100}%" stop-color="${c}"/>`).join("");
      out += `<defs><linearGradient id="exportRamp">${stops}</linearGradient></defs>`;
      out += text(0, y + 13, it.min, 14) + `<rect x="${60}" y="${y}" width="220" height="16" fill="url(#exportRamp)" stroke="#f4f7fb"/>` + text(288, y + 13, it.max, 14);
      out += text(340, y + 13, it.note, 13, 400, "#c3ccd8");
      y += rowH;
      continue;
    }
    const w = 34 + 8 + it.label.length * 7.4 + 22;
    if (x > 0 && x + w > width) { x = 0; y += rowH; }
    if (it.kind === "swatch") out += `<rect x="${x}" y="${y}" width="34" height="18" fill="${it.base ?? it.fill}" stroke="#f4f7fb"/>` + (it.base ? `<rect x="${x}" y="${y}" width="34" height="18" fill="${it.fill}"/>` : "");
    else out += `<line x1="${x}" y1="${y + 9}" x2="${x + 34}" y2="${y + 9}" stroke="${it.stroke}" stroke-width="3" ${it.dash ? `stroke-dasharray="${it.dash}"` : ""}/>`;
    out += text(x + 42, y + 14, it.label, 14);
    x += w;
  }
  return { svg: out, height: y + rowH - y0 };
}

export async function exportChartPng({ svgEl, title, lines, legend, filename, scale = 2 }) {
  if (!svgEl) throw new Error("The chart is not on screen, so it cannot be exported.");
  // A live chart is measured on screen; one built in memory (the calendar) states its own size.
  const box = isLive(svgEl) ? svgEl.getBoundingClientRect() : { width: Number(svgEl.getAttribute("width")), height: Number(svgEl.getAttribute("height")) };
  const cw = Math.ceil(box.width), ch = Math.ceil(box.height);
  const W = Math.max(cw, 640);
  const headH = 28 + lines.length * 22 + 12;
  const clone = inlineCopy(svgEl);
  clone.setAttribute("x", 0); clone.setAttribute("y", headH);
  clone.setAttribute("width", cw); clone.setAttribute("height", ch);
  const leg = legendSvg(legend, W, headH + ch + 14);
  const H = headH + ch + 14 + leg.height + 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#0a0e13"/>`
    + text(0, 24, title, 22, 700)
    + lines.map((l, i) => text(0, 24 + (i + 1) * 22, l, 15, 400, "#c3ccd8")).join("")
    + new XMLSerializer().serializeToString(clone)
    + leg.svg
    + text(0, H - 10, "Harmonized values are model estimates, not observations. Data: NASA FIRMS (MODIS, VIIRS).", 13, 400, "#c3ccd8")
    + "</svg>";

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("The browser could not render the chart image."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = W * scale; canvas.height = H * scale;
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The browser could not create the PNG.");
    downloadBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}
