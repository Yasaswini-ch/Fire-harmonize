import { useState } from "react";
import { aoiFields, validateBboxInput } from "../lib/aoi.js";

// Display order and names: north, south, west, east. The keys are the ones lib/aoi.js uses.
const FIELDS = [
  ["maxLat", "North"], ["minLat", "South"], ["minLon", "West"], ["maxLon", "East"],
];

// Remounted (via `key` in App) whenever the AOI changes elsewhere, so the fields always show the
// current AOI. For a polygon they show its bounding box. Starts folded.
export default function AoiForm({ aoi, onApply }) {
  const [fields, setFields] = useState(() => aoiFields(aoi));
  const check = validateBboxInput(fields);

  return (
    <form className="coords" onSubmit={(e) => { e.preventDefault(); if (check.ok) onApply(check.aoi); }} noValidate>
      <details className="fold">
        <summary>Enter coordinates instead</summary>
        <div className="fields coords-fields">
          {FIELDS.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                value={fields[key]}
                inputMode="decimal"
                aria-invalid={Boolean(check.errors[key])}
                aria-describedby={check.errors[key] ? `err-${key}` : undefined}
                onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
              />
              {check.errors[key] && <span id={`err-${key}`} className="field-error" role="alert">{check.errors[key]}</span>}
            </label>
          ))}
        </div>
        {aoi.type === "polygon" && <p className="hint">The polygon's bounding box is shown. Apply replaces the polygon with this rectangle.</p>}
        <button type="submit" disabled={!check.ok}>Apply</button>
      </details>
    </form>
  );
}
