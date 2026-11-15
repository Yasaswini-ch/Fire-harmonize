// The fixed prose of "How the numbers are made": shared by the results page and the PDF report so they cannot differ.
// No numbers in it; every figure comes from the data.
export const METHOD_PARAGRAPH =
  "Fire satellites record hotspots. VIIRS has smaller pixels and sees smaller fires, so it counts more than MODIS does. We add up detections into grid cells by month. Where VIIRS was not yet flying, we estimate what VIIRS would have counted from MODIS, using a statistical model fitted on the years both sensors flew. We tested that model by leaving one year out at a time. Estimated months carry a range taken from the model's past errors; it is an empirical range, not a formal confidence interval. The most recent months use near-real-time data, are marked provisional, and can change. All values are model estimates, not observations.";

export const METHOD_CHOICES = [
  { title: "VIIRS-equivalent, not MODIS-equivalent.",
    text: "VIIRS sees smaller fires and its satellites keep flying, while the MODIS satellites are ageing. The cost: the early record is not observed at VIIRS quality. Before VIIRS existed, every number is a model estimate with a range. A MODIS-equivalent series would keep the whole record as observed, but it would throw away small-fire detail and end when MODIS ends." },
  { title: "NASA FIRMS standard archive, not swath products.",
    text: "We use FIRMS point detections because anyone can download them and rerun this work. The cost: no per-pixel handling of cloud or viewing angle, which the original swath files would allow. The filters we applied are listed under Limitations below." },
  { title: "One VIIRS reference, with the platforms checked against each other.",
    text: "Different VIIRS satellites cross at different times of day, which could create false trends. We use Suomi NPP as the reference and compare NOAA-20 with it over their overlap (the bridge ratio below) instead of assuming they match." },
  { title: "Monthly, on a 0.25 degree grid.",
    text: "The calendar is for finding patterns: seasons, busy years, and how the current month compares with normal. Daily counts are too noisy for that and would hide the pattern. Weekly counts could work, but a calendar with that many cells is much harder to read. The cost: a short event inside one month is not visible here." },
  { title: "Who it is for.",
    text: "Emergency responders and land managers who need to know whether a month is unusual, and scientists who need a consistent record with its uncertainty stated. Not a fire-spread forecast, and not a replacement for the live FIRMS map." },
];
