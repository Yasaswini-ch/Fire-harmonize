import { createContext, useContext, useEffect, useRef } from "react";

// Each chart registers how to export its own PNG under a name ("calendar", "seasonal", "anomaly"). See ExportRegistry.jsx.
export const ExportContext = createContext(null);

export function useRegisterExport(name, fn) {
  const registry = useContext(ExportContext);
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => {
    if (!registry) return undefined;
    const map = registry.current;
    map.set(name, () => latest.current());
    return () => { map.delete(name); };
  }, [registry, name]);
}
