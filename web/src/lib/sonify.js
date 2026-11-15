// Turns monthly rows into a list of notes. Pure, no Web Audio here, so it can be tested.
//
// Pitch = detections (square-root scale, 15 steps of a major pentatonic scale over three octaves, so any
// two months sound consonant). Months with 0 detections are silent. VIIRS-native months are a single
// sine tone. MODIS-estimated months play TWO triangle tones, one at the low end and one at the high end of
// the estimate's range: a wide gap you can hear is a wide uncertainty. Provisional months are short.
const SCALE = [0, 2, 4, 7, 9]; // semitones of a major pentatonic scale
const STEPS = 15;
const BASE_HZ = 110;

export function pitchFor(count, max) {
  if (!(count > 0) || !(max > 0)) return null;
  const i = Math.max(0, Math.min(STEPS - 1, Math.round(Math.sqrt(Math.min(count, max) / max) * (STEPS - 1))));
  return BASE_HZ * 2 ** ((Math.floor(i / SCALE.length) * 12 + SCALE[i % SCALE.length]) / 12);
}

// rows: [{ month, count, lo, hi, source, provisional }] in time order.
// Returns { notes: [{ month, t, dur, gain, wave, freqs }], seconds }. The piece never lasts more than maxSeconds.
export function buildNotes(rows, { msPerMonth = 110, maxSeconds = 30 } = {}) {
  if (rows.length === 0) return { notes: [], seconds: 0 };
  const step = Math.min(msPerMonth, (maxSeconds * 1000) / rows.length) / 1000;
  const max = Math.max(...rows.map((r) => r.count), 0);
  const notes = [];
  rows.forEach((r, i) => {
    const main = pitchFor(r.count, max);
    if (main === null) return;
    if (r.source === "modis_estimated") {
      const lo = pitchFor(r.lo, max) ?? main;
      const hi = pitchFor(r.hi, max) ?? main;
      notes.push({ month: r.month, t: i * step, dur: step * 0.9, gain: 0.07, wave: "triangle", freqs: lo === hi ? [lo] : [lo, hi] });
    } else {
      notes.push({ month: r.month, t: i * step, dur: step * (r.provisional ? 0.4 : 0.9), gain: 0.16, wave: "sine", freqs: [main] });
    }
  });
  return { notes, seconds: rows.length * step };
}
