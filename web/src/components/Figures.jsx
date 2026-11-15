// "Show your work": the three pictures the pipeline draws while it harmonizes and tests the record, as they came out of
// the run that produced the numbers (copied to public/figures/ by pipeline/04_export.py). Nothing is redrawn here.
const FIGURES = [
  {
    kind: "raw", width: 1680, height: 540, title: "1. The problem: raw counts from the two satellites",
    alt: (r) => `Two line charts of raw monthly detections for ${r}, on a linear and a log scale. MODIS counts run from 2002. VIIRS counts start in 2012 and are much higher.`,
    text: "MODIS (orange) is the long record from 2002. VIIRS (blue and green) starts in 2012 and counts far more fires because it sees smaller ones. Added together, the two would show a jump in 2012 that is not real.",
  },
  {
    kind: "validation", width: 1680, height: 600, title: "2. The fix, tested by leaving each year out",
    alt: (r) => `Left: predicted against observed monthly detections for years the model was not fitted on, close to the 1:1 line. Right: the harmonized monthly series for ${r}, with MODIS-estimated months drawn with a range.`,
    text: "Left: every dot is a month predicted by a model that never saw that year (fitted on 2012 to 2021). Closer to the line is better; the spread at low counts is why small areas are less certain. Right: the harmonized series. Orange is estimated from MODIS and carries a 10 to 90 percent range, blue is VIIRS as observed, pink is provisional.",
  },
  {
    kind: "drift", width: 1440, height: 540, title: "3. Does it hold up over time?",
    alt: () => "Median error and bias by year, for the held-out years 2012 to 2021 and for the same model applied from 2022 on.",
    text: "Blue is the error in each held-out year. Orange applies the same model to 2022 onward, after Aqua's overpass time started to drift. It is a check, not a tuning target: the model is never used to estimate months after 2021.",
  },
];

export default function Figures({ regionId, regionName }) {
  if (!regionId) return null;
  const base = import.meta.env.BASE_URL;
  return (
    <div className="figures">
      <h2>Show your work: how it was trained and tested</h2>
      <p className="hint">These pictures are drawn by the pipeline in the same run as the numbers on this page. They are not redrawn or edited for the site.</p>
      {FIGURES.map((f) => {
        const src = `${base}figures/${regionId}_${f.kind}.png`;
        return (
          <figure key={f.kind} className="figure-card">
            <h3>{f.title}</h3>
            <a href={src} target="_blank" rel="noreferrer">
              <img src={src} alt={f.alt(regionName)} width={f.width} height={f.height} loading="lazy" />
            </a>
            <figcaption>{f.text}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
