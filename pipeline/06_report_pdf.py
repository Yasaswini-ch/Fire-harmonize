"""Write one PDF report per region with ReportLab, in the same dark theme and with the same content as the web app.

Inputs (both must exist, otherwise this stops with a message):
  data/interim/report_{region}.json  written by `node web/scripts/report_data.mjs`. It holds every number and sentence,
                                     computed with the web app's own code, so the PDF and the screen cannot disagree.
  web/public/data/meta.json          written by 04_export.py (model, validation tables, filters).
Output: web/public/reports/{region}.pdf

The report covers the whole region over the full record. It cannot cover a drawn area, because a static site has no
server to render one; the app says so next to the download link.

    python pipeline/06_report_pdf.py
"""
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from matplotlib import colormaps
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph, Spacer,
                                Table, TableStyle)

from common import INTERIM, ROOT

PUBLIC = ROOT / "web" / "public"
OUT = PUBLIC / "reports"

# Same tokens as web/src/index.css.
PAGE, CARD, BORDER = colors.HexColor("#0e1014"), colors.HexColor("#151820"), colors.HexColor("#262b36")
TEXT, MUTED = colors.HexColor("#e8eaf0"), colors.HexColor("#9aa3b2")
ACCENT, PINK = colors.HexColor("#f0b84a"), colors.HexColor("#ff5fa2")
VIRIDIS = colormaps["viridis"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MARGIN = 16 * mm
WIDTH = A4[0] - 2 * MARGIN

H1 = ParagraphStyle("h1", fontName="Times-Bold", fontSize=24, leading=28, textColor=TEXT, spaceAfter=2)
H2 = ParagraphStyle("h2", fontName="Times-Bold", fontSize=16, leading=20, textColor=TEXT, spaceBefore=10, spaceAfter=4)
H3 = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=10.5, leading=14, textColor=ACCENT, spaceBefore=8, spaceAfter=2)
BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=TEXT, spaceAfter=4)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8.5, leading=12, textColor=MUTED)
BULLET = ParagraphStyle("bullet", parent=BODY, leftIndent=10, bulletIndent=0)
CELL = ParagraphStyle("cell", parent=BODY, fontSize=8.5, leading=11, spaceAfter=0)
CELLB = ParagraphStyle("cellb", parent=CELL, fontName="Helvetica-Bold")


def p(text, style=BODY):
    return Paragraph(escape(str(text)), style)


def rich(markup, style=BODY):
    return Paragraph(markup, style)


def fmt(n):
    return f"{round(n):,}"


def pct(x):
    return "n/a" if x is None else f"{x:.1f}%"


def month_label(ym):
    names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    return f"{names[int(ym[5:7]) - 1]} {ym[:4]}"


class Card(Flowable):
    """Content on a card background, so the PDF keeps the app's boxed look."""

    def __init__(self, flowables, width=WIDTH, pad=9):
        super().__init__()
        self.flowables, self.w, self.pad = flowables, width, pad
        self.h = 0

    def wrap(self, aw, ah):
        inner = self.w - 2 * self.pad
        self.h = self.pad
        self.sizes = []
        for f in self.flowables:
            _, fh = f.wrap(inner, ah)
            sp = f.getSpaceBefore() + f.getSpaceAfter()
            self.sizes.append(fh + sp)
            self.h += fh + sp
        self.h += self.pad
        return self.w, self.h

    def draw(self):
        c = self.canv
        c.setFillColor(CARD)
        c.setStrokeColor(BORDER)
        c.roundRect(0, 0, self.w, self.h, 5, fill=1, stroke=1)
        y = self.h - self.pad
        for f, s in zip(self.flowables, self.sizes):
            fh = s - f.getSpaceBefore() - f.getSpaceAfter()
            y -= f.getSpaceBefore() + fh
            f.drawOn(c, self.pad, y)
            y -= f.getSpaceAfter()


class StatRow(Flowable):
    """The five headline numbers; the first, in the accent colour, is now vs normal."""

    def __init__(self, stats):
        super().__init__()
        self.stats = stats

    def wrap(self, aw, ah):
        return WIDTH, 58

    def draw(self):
        c = self.canv
        n = len(self.stats)
        gap = 5
        bw = (WIDTH - gap * (n - 1)) / n
        for i, (label, value, note) in enumerate(self.stats):
            x = i * (bw + gap)
            c.setFillColor(CARD)
            c.setStrokeColor(ACCENT if i == 0 else BORDER)
            c.roundRect(x, 0, bw, 58, 5, fill=1, stroke=1)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 7.5)
            c.drawString(x + 6, 46, label.upper())
            c.setFillColor(ACCENT if i == 0 else TEXT)
            size = 17 if len(value) <= 9 else 12
            c.setFont("Times-Bold", size)
            c.drawString(x + 6, 27, value)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 7)
            c.drawString(x + 6, 10, note)


def ramp(t):
    r, g, b, _ = VIRIDIS(max(0.0, min(1.0, t)))
    return colors.Color(r, g, b)


class Calendar(Flowable):
    """Years across, months down. Viridis on a log scale; diagonal lines = MODIS-estimated, dots = provisional,
    white line = where VIIRS observations begin, pink outline = the five highest months."""

    LABEL, MED = 26, 34

    def __init__(self, model):
        super().__init__()
        self.m = model
        n = len(model["years"])
        self.cw = (WIDTH - self.LABEL - self.MED) / n
        self.ch = 13.5
        self.top = 26  # brackets and year labels
        self.bot = 16  # totals row
        self.height = self.top + 12 * self.ch + self.bot

    def wrap(self, aw, ah):
        return WIDTH, self.height

    def draw(self):
        c, m = self.canv, self.m
        x0, cw, ch = self.LABEL, self.cw, self.ch
        gridtop = 12 * ch + self.bot
        # brackets
        for key, name in (("estimated", "MODIS-estimated, with a range"), ("native", "VIIRS observed")):
            s = m["spans"].get(key)
            if not s:
                continue
            xa, xb = x0 + s["startCol"] * cw, x0 + (s["startCol"] + s["span"]) * cw
            c.setStrokeColor(MUTED)
            c.setLineWidth(0.6)
            c.line(xa + 1, gridtop + 20, xb - 1, gridtop + 20)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 6.8)
            c.drawCentredString((xa + xb) / 2, gridtop + 22.5, name)
        c.setFont("Helvetica", 6.2)
        c.setFillColor(MUTED)
        for i, y in enumerate(m["years"]):
            c.drawCentredString(x0 + (i + 0.5) * cw, gridtop + 9, str(y)[2:] if cw < 14 else str(y))
        c.drawCentredString(x0 + len(m["years"]) * cw + self.MED / 2, gridtop + 9, "Median")
        for r in m["months"]:
            y = gridtop - (r["index"] + 1) * ch
            c.setFillColor(ACCENT if r["inSeason"] else MUTED)
            c.setFont("Helvetica-Bold" if r["inSeason"] else "Helvetica", 7)
            c.drawString(0, y + 4, r["name"])
            for cell in r["cells"]:
                if cell is None:
                    continue
                x = x0 + cell["col"] * cw
                c.setFillColor(ramp(cell["t"]))
                c.rect(x, y, cw, ch, fill=1, stroke=0)
                lum = 0.5 if cell["t"] > 0.55 else 0.9
                if cell["status"] == "estimated":
                    c.saveState()
                    p_ = c.beginPath()
                    p_.rect(x, y, cw, ch)
                    c.clipPath(p_, stroke=0, fill=0)
                    c.setStrokeColor(colors.Color(lum, lum, lum))
                    c.setLineWidth(0.5)
                    k = -ch
                    while k < cw:
                        c.line(x + k, y, x + k + ch, y + ch)
                        k += 4
                    c.restoreState()
                elif cell["status"] == "provisional":
                    c.setFillColor(colors.Color(lum, lum, lum))
                    c.circle(x + cw / 2, y + ch / 2, 1.1, fill=1, stroke=0)
                c.setStrokeColor(PAGE)
                c.setLineWidth(0.3)
                c.rect(x, y, cw, ch, fill=0, stroke=1)
                c.setStrokeColor(colors.white)
                c.setLineWidth(1.4)
                if cell["edgeLeft"]:
                    c.line(x, y, x, y + ch)
                if cell["edgeTop"]:
                    c.line(x, y + ch, x + cw, y + ch)
                if cell["top5"]:
                    c.setStrokeColor(PINK)
                    c.setLineWidth(1.6)
                    c.rect(x + 0.8, y + 0.8, cw - 1.6, ch - 1.6, fill=0, stroke=1)
            c.setFillColor(TEXT)
            c.setFont("Helvetica", 6.8)
            if r["median"] is not None:
                c.drawRightString(x0 + len(m["years"]) * cw + self.MED - 2, y + 4, fmt(r["median"]))
        # totals row
        c.setFont("Helvetica", 5.6)
        c.setFillColor(MUTED)
        c.drawString(0, 5, "Total")
        for i, t in enumerate(m["totals"]):
            txt = f"{round(t['total'] / 1000)}k" if t["total"] >= 1000 else str(round(t["total"]))
            if t["partial"]:
                txt += "*"
            c.drawCentredString(x0 + (i + 0.5) * cw, 5, txt)


class Bars(Flowable):
    """Simple bar chart: values per label, optional reference lines, per-bar colours."""

    def __init__(self, labels, values, bar_colors, height=110, lines=(), zero_based=True, spread=None, value_fmt=None, values2=None, colors2=None):
        super().__init__()
        self.values2, self.colors2 = values2, colors2
        self.labels, self.values, self.bc = labels, values, bar_colors
        self.h, self.lines, self.zero_based, self.spread, self.vf = height, lines, zero_based, spread, value_fmt

    def wrap(self, aw, ah):
        return WIDTH, self.h + 22

    def draw(self):
        c = self.canv
        vals = list(self.values) + [v for l in self.lines for v in (l[0],)]
        if self.spread:
            vals += [hi for _, hi in self.spread if hi is not None]
        vals += list(self.values2 or [])
        lo = min(0, min(vals)) if self.zero_based else min(vals)
        hi = max(vals)
        if hi == lo:
            hi = lo + 1
        left, n = 4, len(self.values)
        bw = (WIDTH - left) / n
        base = 14
        sy = lambda v: base + (v - lo) / (hi - lo) * (self.h - 8)
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.5)
        c.line(left, sy(0), WIDTH, sy(0))
        for val, color, dash in self.lines:
            c.setStrokeColor(color)
            c.setDash(2, 2)
            c.line(left, sy(val), WIDTH, sy(val))
            c.setDash()
        for i, (lab, v) in enumerate(zip(self.labels, self.values)):
            x = left + i * bw
            c.setFillColor(self.bc[i])
            y0, y1 = sy(0), sy(v)
            if self.values2:
                c.rect(x + bw * 0.1, min(y0, y1), bw * 0.38, abs(y1 - y0), fill=1, stroke=0)
                c.setFillColor(self.colors2[i])
                y2 = sy(self.values2[i])
                c.rect(x + bw * 0.52, min(y0, y2), bw * 0.38, abs(y2 - y0), fill=1, stroke=0)
            else:
                c.rect(x + bw * 0.18, min(y0, y1), bw * 0.64, abs(y1 - y0), fill=1, stroke=0)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 6.2 if n > 14 else 7.5)
            c.drawCentredString(x + bw / 2, 3, lab)
            if self.vf and n <= 14:
                c.setFillColor(TEXT)
                c.setFont("Helvetica", 6.5)
                c.drawCentredString(x + bw / 2, max(y0, y1) + 2, self.vf(v))


def table(rows, widths, header=True, highlight=None):
    data = [[Paragraph(escape(str(v)), CELLB if (header and r == 0) else CELL) for v in row] for r, row in enumerate(rows)]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [("BACKGROUND", (0, 0), (-1, -1), CARD), ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
          ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if header:
        st.append(("BACKGROUND", (0, 0), (-1, 0), BORDER))
    if highlight is not None:
        st.append(("BACKGROUND", (0, highlight), (-1, highlight), colors.HexColor("#2a2415")))
    t.setStyle(TableStyle(st))
    return t


def stat_values(rep):
    c, rows = rep["comparison"], rep["rows"]
    pm, py = rep["topMonths"][0], rep["topYears"][0]
    est = rep["estimatedMonths"]
    if c and c.get("label") is not None and c.get("percentDiff") is not None:
        pd = c["percentDiff"]
        now = (f"{'+' if pd >= 0 else '-'}{abs(round(pd))}%", f"{month_label(c['month'])[:3] + month_label(c['month'])[-5:]} vs median" + (", prov." if c["provisional"] else ""))
    else:
        now = ("n/a", "no baseline")
    return [
        ("Now vs normal", now[0], now[1]),
        ("Detections in range", fmt(rep["total"]), f"{len(rows)} months"),
        ("Peak month", month_label(pm["month"]), f"{fmt(pm['count'])} detections"),
        ("Peak year", str(py["year"]), f"{fmt(py['total'])} detections"),
        ("Estimated share", f"{round(100 * est / len(rows))}%", f"{est} of {len(rows)} months"),
    ]


def seasonal_bars(rep):
    base = rep["baseline"]
    year = max(t["year"] for t in rep["calendar"]["totals"] if not t["partial"])
    cur = {int(r["month"][5:]): r["count"] for r in rep["rows"] if int(r["month"][:4]) == year}
    medians = [b["median"] or 0 for b in base]
    return year, medians, [cur.get(i + 1, 0) for i in range(12)]


def annual_table(rep):
    rows = [["Year", "Total detections", "Range (low to high)", "Source"]]
    for t in rep["anomaly"]["years"]:
        src = "modis_estimated" if t["estimated"] else ("provisional" if t["provisional"] else "viirs_native")
        rows.append([t["year"], fmt(t["total"]), f"{fmt(t['lo'])} to {fmt(t['hi'])}" if t["estimated"] else "observed", src])
    return rows


def methods_story(meta, rep, rid):
    s = []
    m = meta.get("regions", {}).get(rid, {})
    f = meta.get("filters", {})
    s += [p("How the numbers are made", H2), p(rep["methodParagraph"])]
    s.append(p("Choices we made, and what each costs", H3))
    for ch in rep["methodChoices"]:
        s.append(rich(f"<b>{escape(ch['title'])}</b> {escape(ch['text'])}", BULLET))
    aoi = (m.get("cv", {}).get("chosen", {}) or {}).get("aoi", {})
    s.append(p(f"Model and validation for {rep['region']['name']}", H3))
    fit = m.get("model", {}).get("fitWindow")
    s.append(table([
        ["Chosen model", m.get("model", {}).get("name", "not in meta.json")],
        ["Fitted on months", f"{fit[0]} to {fit[1]}" if fit else "not in meta.json"],
        ["Held-out years (cross-validation)", m.get("model", {}).get("cvFolds", "not in meta.json")],
        ["Area-level median error", pct(aoi.get("median_ape_pct"))],
        ["Area-level bias", pct(aoi.get("bias_pct"))],
    ], [WIDTH * 0.42, WIDTH * 0.58], header=False))
    if m.get("cv", {}).get("interval"):
        s.append(p(f"Range: {m['cv']['interval']}.", SMALL))
    sel = m.get("modelSelection")
    if sel:
        s += [p("How the model was chosen", H3), p(sel.get("rule", ""))]
        rows = [["Model", "Median error", "Bias", "Within bias limit"]]
        hi = None
        for i, cd in enumerate(sel["candidates"], 1):
            rows.append([f"{cd['model']} {cd['name']}" + (" (used)" if cd["model"] == sel["chosen"] else ""), pct(cd.get("medianApePct")),
                         pct(cd.get("biasPct")), "yes" if cd.get("qualifies") else "no"])
            if cd["model"] == sel["chosen"]:
                hi = i
        s.append(table(rows, [WIDTH * 0.46, WIDTH * 0.18, WIDTH * 0.16, WIDTH * 0.2], highlight=hi))
        if sel.get("note"):
            s.append(p(sel["note"], SMALL))
    classes = m.get("sizeClasses") or []
    if classes:
        whole = [c for c in classes if c["id"] == "region"]
        sized = sorted([c for c in classes if c["id"] != "region"], key=lambda c: c["minDeg"])
        rows = [["Area (longer side)", "Sample areas", "Median error", "Bias", "Count-weighted error", "Interval hit rate"]]
        for c in sized + whole:
            cov = c.get("coverage") or {}
            rows.append([c["label"], c.get("nAois", ""), pct(c.get("medianApePct")), pct(c.get("biasPct")), pct(c.get("countWeightedErrorPct")),
                         f"{round(cov['heldOutYearsPct'])}%" if cov.get("heldOutYearsPct") is not None else "n/a"])
        s.append(p("Error by area size", H3))
        s.append(table(rows, [WIDTH * 0.24, WIDTH * 0.13, WIDTH * 0.15, WIDTH * 0.12, WIDTH * 0.2, WIDTH * 0.16]))
        s.append(p("Same sample areas and held-out predictions for every row. Median error counts only months with detections, so it is "
                   "pushed up by months with few of them; count-weighted error is not. Interval hit rate is the share of months inside the "
                   "stated range, measured on years left out when the range was set. Error and bias are measured on held-out years over many "
                   "sample areas, not on a drawn area. Areas smaller than the smallest size sampled were not measured.", SMALL))
    s.append(p("Limitations", H3))
    lim = [
        f"The MODIS-to-VIIRS relationship was estimated on {fit[0]} to {fit[1]} and is assumed to hold for earlier years. That cannot be checked." if fit else None,
        "Counts are detections, not area burned. Detections are not unique fires: one fire can produce many detections.",
        "Values are VIIRS-equivalent, because VIIRS sees smaller fires than MODIS.",
        (f"Confidence filtering: MODIS detections below confidence {f.get('modis_min_confidence')} are dropped; VIIRS detections of "
         f"{', '.join({'l': 'low', 'n': 'nominal', 'h': 'high'}.get(c, c) for c in f.get('viirs_dropped_confidence', []))} confidence are dropped; "
         f"only type {f.get('type_kept')} (presumed vegetation fire) is kept.") if f else None,
        "Recent months are provisional: they use near-real-time data and may change when standard processing replaces them.",
        (f"The MODIS series uses {', '.join(f.get('modis_platforms_kept', []))} only. {meta.get('platformNote', '')}") if f else None,
        m.get("driftDiagnostic", {}).get("note"),
    ]
    b = m.get("bridgeNoaa20ToSnpp")
    if b and isinstance(b.get("aoiMedianRatio"), (int, float)):
        lim.append(f"Bridge, NOAA-20 against Suomi NPP: median ratio {b['aoiMedianRatio']:.3f} for the area-level check "
                   f"(regional monthly median {b.get('regionMonthlyMedianRatio', float('nan')):.3f}); scaling "
                   f"{'applied' if b.get('scalingApplied') else 'not applied'}."
                   + (" Over the latest months the ratio is outside the range we accept, so the handover to NOAA-20 may add a step."
                      if b.get("recentOutsideTolerance") else ""))
    mt = (meta.get("staticMaskValidation", {}).get("regions", {}).get(rid, {}) or {}).get("exact")
    if mt:
        lim.append(f"Near-real-time months have no type field, so they are filtered with a location mask. Tested on NOAA-20 data treated as if it had "
                   f"no type field, the mask removes {mt['recall_pct']:.1f}% of static sources and falsely removes {mt['false_drop_pct']:.2f}% of real vegetation fires.")
    for item in lim:
        if item:
            s.append(Paragraph(escape(item), BULLET, bulletText="-"))
    return s


def build(rid, meta):
    src = INTERIM / f"report_{rid}.json"
    if not src.exists():
        raise SystemExit(f"Missing {src}. Run: node web/scripts/report_data.mjs")
    rep = json.loads(src.read_text(encoding="utf-8"))
    name = rep["region"]["name"]
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{rid}.pdf"

    def decorate(canv, doc):
        canv.saveState()
        canv.setFillColor(PAGE)
        canv.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
        canv.setFillColor(MUTED)
        canv.setFont("Helvetica", 7.5)
        canv.drawString(MARGIN, 9 * mm, f"Fire Harmonize: {name}. Harmonized values are model estimates, not observations.")
        canv.drawRightString(A4[0] - MARGIN, 9 * mm, f"Data version {rep['dataVersion']}   page {doc.page}")
        canv.restoreState()

    doc = BaseDocTemplate(str(path), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=16 * mm,
                          title=f"Burning activity report: {name}", author="Fire Harmonize",
                          subject="Harmonized MODIS and VIIRS active-fire detections")
    doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(MARGIN, 16 * mm, WIDTH, A4[1] - MARGIN - 16 * mm, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=decorate)])

    rows = rep["rows"]
    s = [p("Burning activity report", H1), p(f"{name}, {month_label(rows[0]['month'])} to {month_label(rows[-1]['month'])}, whole region", ParagraphStyle("sub", parent=BODY, fontSize=11, textColor=MUTED)),
         p(f"Harmonized NASA FIRMS MODIS and VIIRS active-fire detections on one VIIRS-equivalent monthly scale. Data version {rep['dataVersion']}, generated {rep['generated']}.", SMALL),
         Spacer(1, 6), StatRow(stat_values(rep)), Spacer(1, 4),
         p("VIIRS-equivalent detections. Harmonized values are model estimates, not observations.", SMALL)]

    cal = [p("Burning activity calendar", H2), Calendar(rep["calendar"]), Spacer(1, 3),
           p(f"{rep['calendar']['scaleLabel']}: brighter is more detections. Diagonal lines are MODIS-estimated months (each has a range, see the annual table). "
             "Dots mark provisional months. The white line is where VIIRS observations begin. Pink outlines are the five highest months. "
             "Median is the typical count for that calendar month. * marks a partial year.", SMALL)]
    s += [Card(cal), Spacer(1, 8)]

    # results at a glance
    glance = [p("Results and how to read the graphs", H2), p("What we did", H3)] + [p(t) for t in rep["findings"]["did"]]
    glance.append(p(f"What it shows for {name}", H3))
    for it in rep["findings"]["shows"]:
        glance.append(rich(f"<b>{escape(it['label'])}.</b> {escape(it['text'])}", BODY))
    s += [Card(glance), Spacer(1, 8)]

    year, medians, cur = seasonal_bars(rep)
    seas = [p("Seasonal profile", H2),
            Bars(MONTHS, medians, [colors.HexColor("#6b7384")] * 12, height=105, values2=cur, colors2=[ACCENT] * 12),
            p(f"Grey bars: typical (median) detections in each calendar month over {rep['baselineYears']} baseline years. "
              f"Gold bars: {year}, the latest complete year, so you can see whether it ran early, late, high or low.", SMALL)]
    s += [KeepTogether([Card(seas)]), Spacer(1, 8)]

    an = rep["anomaly"]
    yrs = [y for y in an["years"] if y["z"] is not None]
    cols = [PINK if y["flag"] else (colors.HexColor("#6b7384") if y["estimated"] else ACCENT) for y in yrs]
    anomaly = [p("Annual anomaly (z-score)", H2),
               Bars([str(y["year"])[2:] for y in yrs], [y["z"] for y in yrs], cols, height=110, lines=[(2, PINK, 1), (-2, PINK, 1)], zero_based=False),
               p(f"How far each complete year is from the {an['baselineYears']}-year baseline average, in standard deviations. Bars past the dashed lines (2) are unusual years "
                 "(pink). Grey bars are years estimated from MODIS, so their z-scores carry that uncertainty.", SMALL)]
    s += [KeepTogether([Card(anomaly)]), PageBreak()]

    s += [p("How to read each graph", H2)]
    for g in (g for g in rep["guide"] if g["id"] != "map"):  # the map is not in the PDF
        s.append(rich(f"<b>{escape(g['title'])}.</b> {escape(g['text'])}"))
    s += methods_story(meta, rep, rid)

    s += [PageBreak(), p("Annual totals with ranges and source flags", H2),
          p("Every estimated year carries a range from the model's past errors (an empirical range, not a formal confidence interval). "
            "Source flags: viirs_native is observed by VIIRS; modis_estimated is estimated from MODIS; provisional uses near-real-time data and may change.", SMALL),
          table(annual_table(rep), [WIDTH * 0.14, WIDTH * 0.26, WIDTH * 0.32, WIDTH * 0.28]),
          p("Five highest months", H3),
          table([["Month", "Detections", "Range", "Source"]] + [
              [month_label(t["month"]), fmt(t["count"]), f"{fmt(t['lo'])} to {fmt(t['hi'])}" if t["source"] == "modis_estimated" else "observed",
               "provisional" if t["provisional"] else t["source"]] for t in rep["topMonths"]],
                [WIDTH * 0.3, WIDTH * 0.25, WIDTH * 0.3, WIDTH * 0.15]),
          Spacer(1, 6),
          p("Credits: fire detections from NASA FIRMS (MODIS Collection 6.1, VIIRS S-NPP and NOAA-20). Basemap and code: see the project README. "
            "This report covers the whole region; for a smaller area use the web app, which widens the ranges for small areas.", SMALL)]
    doc.build(s)
    return path


def main():
    meta_path = PUBLIC / "data" / "meta.json"
    if not meta_path.exists():
        raise SystemExit(f"Missing {meta_path}. Run pipeline/04_export.py first.")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    regions = json.loads((PUBLIC / "data" / "regions.json").read_text(encoding="utf-8"))
    for r in regions:
        path = build(r["id"], meta)
        print(f"{r['id']}: {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    sys.exit(main())
