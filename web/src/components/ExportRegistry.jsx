import { useContext, useRef, useState } from "react";
import { ExportContext } from "./exportContext.js";

// The calendar header and the Export section both call a chart's export through <ExportButton>, so there is one export
// path per chart (charts register themselves with useRegisterExport, in exportContext.js). A button whose chart is not
// on screen shows a plain message instead of failing silently.
export function ExportProvider({ children }) {
  const registry = useRef(new Map());
  return <ExportContext.Provider value={registry}>{children}</ExportContext.Provider>;
}

export function ExportButton({ name, children, className }) {
  const registry = useContext(ExportContext);
  const [state, setState] = useState({ busy: false, error: null });
  async function go() {
    const run = registry?.current.get(name);
    if (!run) { setState({ busy: false, error: "That chart is not on screen, so it cannot be exported." }); return; }
    setState({ busy: true, error: null });
    try {
      await run();
      setState({ busy: false, error: null });
    } catch (err) {
      setState({ busy: false, error: err.message });
    }
  }
  return (
    <span className="img-btn">
      <button type="button" className={className} onClick={go} disabled={state.busy}>{state.busy ? "Preparing image…" : children}</button>
      {state.error && <span className="field-error" role="alert">{state.error}</span>}
    </span>
  );
}
