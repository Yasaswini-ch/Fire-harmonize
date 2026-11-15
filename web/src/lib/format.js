export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Counts are area-weighted and fractional; show whole detections.
export const fmt = (n) => Math.round(n).toLocaleString("en-US");
export const fmtPct = (p) => `${p >= 0 ? "+" : "-"}${Math.abs(Math.round(p)).toLocaleString("en-US")}%`;
export const monthLabel = (ym) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// Screen-reader text for one heatmap cell, e.g. "March 2019: 12,430 detections, estimated, range 9,800 to 15,100".
export function cellLabel(r) {
  const head = `${monthLabel(r.month)}: ${fmt(r.count)} detections`;
  const tail = r.provisional ? ", provisional" : "";
  if (r.source === "modis_estimated") return `${head}, estimated, range ${fmt(r.lo)} to ${fmt(r.hi)}${tail}`;
  return `${head}, VIIRS native${tail}`;
}
