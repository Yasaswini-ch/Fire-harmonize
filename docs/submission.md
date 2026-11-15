# Submission draft (edit before pasting into the form)

Fields marked **[FILL]** need you. Check the real form for its length limits and for how it wants AI use disclosed.

**Project name:** Burning Activity Calendar
**Challenge:** Harmonization of MODIS and VIIRS Hot Spots
**Live demo:** [FILL: deployed URL, opened and checked on a phone]
**Repository:** [FILL]
**Video (about 2 minutes):** [FILL]

## Summary (short)

MODIS and VIIRS count fire differently, so their raw detections cannot be added together: doing so creates a false jump in 2012.
We put both on one VIIRS-equivalent monthly scale and built a calendar that lets responders, land managers and scientists pick any
area and date range and see how burning varies by month and year, how the latest month compares with normal, and how far each
number can be trusted. Every harmonized number carries a range and a source flag (VIIRS native, MODIS-estimated, provisional).

## What it does

- Month-by-year burning activity calendar, from August 2002 to the latest month, for any area inside a processed region
- Busiest months and years, fire season, annual anomalies, and "now vs normal" against the same calendar month
- A map of detections by month, CSV downloads, chart images, a one-page printable brief, a calendar you can listen to,
  and a guided walkthrough
- Accuracy shown in the app: measured error by area size, read from the pipeline's own validation

## How it works

NASA FIRMS standard-processing data (MODIS Aqua, VIIRS Suomi NPP and NOAA-20) is filtered to presumed vegetation fires and summed
into 0.25 degree monthly cells. Months before VIIRS are estimated from MODIS with a ratio fitted separately for each calendar month
on the 2012 to 2021 overlap. Four candidate models are compared by leaving each year out; the lowest-error model whose bias is
within 15 percent is used. Intervals come from held-out residuals and are set by area size. NOAA-20 is bridged to Suomi NPP and
checked over their overlap and over the latest months.

## Validation (honest version)

Typical error of an estimated month, by area size, leave-one-year-out:

- Whole region: 12 percent (Western North America) and 11 percent (Zambia)
- Areas of 3 to 5 degrees: 42 percent and 18 percent
- Areas of 1 to 2 degrees: 100 percent (a median of 15 detections a month) and 21 percent
- Bias: -0.6 percent and +1.8 percent. Interval coverage on held-out years: 76 to 81 percent against an 80 percent target.

Solid at region scale, wider uncertainty for small areas. (Numbers from `data/processed/validation.json`; update them if the
pipeline is re-run.)

## Limits we state in the app

The MODIS to VIIRS relationship is assumed to hold before 2012; counts are detections, not area burned; the latest months are
provisional; Suomi NPP ended on 2 November 2026 and the handover to NOAA-20 may add a step; the static-source mask was measured on 84 months of test data (recall 92 and 82 percent, false drops 0.3 and 0.03 percent for
Western NA and Zambia); one near-real-time month (August 2026, Zambia) is unusually large but was checked against two other instruments and is real, with about 10 percent of sensor uncertainty.

## Data and tools

NASA FIRMS (MODIS C6.1, VIIRS 375 m); Natural Earth; React, Vite, Leaflet, Recharts, three.js. Earth and star imagery from NASA
Blue Marble and NASA SVS.

## AI use disclosure (adapt to the form's wording)

[FILL: confirm and edit.] We used an AI coding assistant (Claude Code by Anthropic) to help write the pipeline, the web app and
the tests under our direction. All numbers shown come from the pipeline and its validation, not from the assistant. The pipeline
refuses to export data marked as fixture data, and the app shows a banner if it is.
