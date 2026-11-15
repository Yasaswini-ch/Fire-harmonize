import { useEffect, useId, useRef, useState } from "react";
import { placePopover, TOUR_STEPS } from "../lib/tour.js";

const CARD = { w: 340, h: 210 };
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Guided walkthrough: dims the page, lights up one real control at a time and explains it. Esc closes,
// the arrow keys move, and focus goes back to where it was when the tour closes.
export default function Tour({ onClose, onView }) {
  const titleId = useId();
  // Only the steps whose target is on the page now; decided once, when the tour opens.
  const [steps] = useState(() => TOUR_STEPS.filter((s) => s.view || document.querySelector(s.selector)));
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const next = useRef(null);
  const cardRef = useRef(null);
  const [cardH, setCardH] = useState(CARD.h); // the card's real height: its text differs from step to step
  const step = steps[i];

  useEffect(() => {
    const opener = document.activeElement;
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    if (!step) return undefined;
    onView?.(step.view ?? "workbench"); // the page this step lives on
    if (step.opens) document.querySelector(step.opens)?.setAttribute("open", ""); // open the collapsed section this step is about
    let cancelled = false;
    let raf = 0;
    let timer = 0;
    let settle = 0;
    let tries = 0;
    let el = null;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    // The target may need a moment to appear after a tab switch; if it never does, move on instead of hanging.
    const attach = () => {
      if (cancelled) return;
      el = document.querySelector(step.selector);
      if (!el) {
        if (tries++ < 12) timer = setTimeout(attach, 80);
        else setI((n) => (n < steps.length - 1 ? n + 1 : n));
        return;
      }
      el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      measure();
      settle = setTimeout(measure, reduced() ? 50 : 450); // after the smooth scroll has finished
      next.current?.focus();
    };
    attach();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(settle);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, steps.length, onView]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const h = cardRef.current?.offsetHeight;
      if (h && h !== cardH) setCardH(h);
    });
    return () => cancelAnimationFrame(id);
  }, [i, rect, cardH]);

  const last = i === steps.length - 1;
  const go = (d) => setI((n) => Math.max(0, Math.min(steps.length - 1, n + d)));
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!step) {
    return (
      <div className="tour-card" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ top: 80, left: 16 }}>
        <h2 id={titleId}>Nothing to show yet</h2>
        <p>The walkthrough needs the data to be loaded. Close this and try again in a moment.</p>
        <div className="tour-actions"><button type="button" onClick={onClose}>Close</button></div>
      </div>
    );
  }
  const view = { w: window.innerWidth, h: window.innerHeight };
  const pos = rect ? placePopover(rect, { w: CARD.w, h: cardH }, view) : { top: 80, left: 16 };
  return (
    <>
      <div className="tour-block" onClick={onClose} aria-hidden="true" />
      {rect && <div className="tour-spot" aria-hidden="true" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />}
      <div ref={cardRef} className="tour-card" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ top: pos.top, left: pos.left, width: CARD.w }}>
        <div className="tour-count">Step {i + 1} of {steps.length}</div>
        <h2 id={titleId}>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="ghost" onClick={onClose}>{last ? "Close" : "Skip"}</button>
          <span className="spacer" />
          {i > 0 && <button type="button" className="ghost" onClick={() => go(-1)}>Back</button>}
          <button type="button" ref={next} onClick={last ? onClose : () => go(1)}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </>
  );
}
