import { useEffect, useState } from "react";
import { offlineSupported, saveForOffline } from "../lib/offline.js";

// Two small pieces for field use: a banner that appears when the connection drops, and a button that saves the
// whole app and its data on this device. The button only appears in the built app (the dev server has no
// service worker or asset manifest to save).
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  if (online) return null;
  return <div className="offline-banner" role="status">Offline. Showing the data saved on this device; numbers may be out of date.</div>;
}

export function SaveOfflineButton() {
  const [state, setState] = useState({ phase: "idle" }); // idle | saving | done | error
  if (!import.meta.env.PROD || !offlineSupported()) return null;
  const run = async () => {
    setState({ phase: "saving", done: 0, total: 0 });
    try {
      const { saved, failed } = await saveForOffline(import.meta.env.BASE_URL, (done, total) => setState({ phase: "saving", done, total }));
      setState(failed.length ? { phase: "error", message: `Saved ${saved} files, could not save ${failed.length}: ${failed.slice(0, 2).join(", ")}${failed.length > 2 ? "…" : ""}` } : { phase: "done", saved });
    } catch (err) {
      setState({ phase: "error", message: err.message });
    }
  };
  return (
    <>
      <button type="button" className="ghost" onClick={run} disabled={state.phase === "saving"}>
        {state.phase === "saving" ? `Saving ${state.done}/${state.total}…` : "Save offline"}
      </button>
      <span role="status" className="ver">
        {state.phase === "done" && `Saved ${state.saved} files for offline use`}
        {state.phase === "error" && state.message}
      </span>
    </>
  );
}
