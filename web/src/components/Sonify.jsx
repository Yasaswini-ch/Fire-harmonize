import { useEffect, useMemo, useRef, useState } from "react";
import { monthLabel } from "../lib/format.js";
import { buildNotes } from "../lib/sonify.js";

// "Listen to the calendar": plays the selected months as sound with the Web Audio API (no dependency).
// Pitch is detections; estimated months are two-note chords whose gap is the uncertainty (see lib/sonify.js).
// The parent gives this a key built from the period, so a new period starts fresh and silent.
// Starts only on a click, as browsers require, and stops on a second click or when the panel goes away.
export default function Sonify({ rows }) {
  const { notes, seconds } = useMemo(() => buildNotes(rows), [rows]);
  const ctx = useRef(null);
  const timer = useRef(0);
  const [status, setStatus] = useState("idle"); // idle | playing | done | unsupported

  const stop = () => {
    clearTimeout(timer.current);
    ctx.current?.close().catch(() => {});
    ctx.current = null;
  };
  useEffect(() => stop, []);

  const play = () => {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) { setStatus("unsupported"); return; }
    stop();
    const c = new AC();
    ctx.current = c;
    const t0 = c.currentTime + 0.1;
    for (const n of notes) {
      for (const f of n.freqs) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = n.wave;
        osc.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + n.t);
        g.gain.linearRampToValueAtTime(n.gain, t0 + n.t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + n.dur);
        osc.connect(g).connect(c.destination);
        osc.start(t0 + n.t);
        osc.stop(t0 + n.t + n.dur + 0.02);
      }
    }
    setStatus("playing");
    timer.current = setTimeout(() => { stop(); setStatus("done"); }, (seconds + 0.5) * 1000);
  };

  const playing = status === "playing";
  const audible = notes.length > 0;
  return (
    <section className="panel" aria-label="Listen to the calendar">
      <div className="panel-head">
        <h2>Listen to the calendar</h2>
        <button type="button" className={playing ? "ghost" : ""} aria-pressed={playing} disabled={!audible}
          onClick={playing ? () => { stop(); setStatus("idle"); } : play}>
          {playing ? "Stop" : `Play ${Math.round(seconds)} seconds`}
        </button>
      </div>
      <p className="hint">{monthLabel(rows[0].month)} to {monthLabel(rows[rows.length - 1].month)}, one month at a time.</p>
      <details className="fold">
        <summary>How it sounds</summary>
        <p className="hint">
          Higher pitch means more detections; silence means none. A hollow two-note chord is a MODIS-estimated month: the wider the gap
          between the two notes, the wider its uncertainty range. A single clean tone is a VIIRS-native month.
        </p>
      </details>
      <p className="hint" role="status">
        {status === "playing" && "Playing…"}
        {status === "done" && "Finished."}
        {status === "unsupported" && "This browser cannot play audio."}
        {!audible && "No detections in this period, so there is nothing to play."}
      </p>
    </section>
  );
}
