import { METHOD_CHOICES, METHOD_PARAGRAPH } from "../lib/methodText.js";

// "How the numbers are made" in plain words, and the choices behind them with what each one costs. The prose lives in
// lib/methodText.js (no numbers in it, shared with the PDF report); every figure is on the Accuracy and methods section.
export default function MethodExplainer() {
  return (
    <>
      <h2>How the numbers are made</h2>
      <p>{METHOD_PARAGRAPH}</p>

      <h3>Choices we made, and what each costs</h3>
      <ul className="limits">
        {METHOD_CHOICES.map((c) => (
          <li key={c.title}><strong>{c.title}</strong> {c.text}</li>
        ))}
      </ul>
    </>
  );
}
