import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet-draw";
import { aoiFromLatLngs } from "../lib/aoi.js";

// Thin wrapper around leaflet-draw. It has no toolbar of its own: the "Draw rectangle" and "Draw polygon" buttons in the
// area card start the tools through `apiRef.current.rectangle()` and `.polygon()`. It only reports finished shapes; the AOI
// itself is drawn from React state, so drawing, the coordinate form and the presets can never disagree.
// showArea is off because leaflet-draw 1.0.4 throws "type is not defined" in its area readout under ES modules.
export default function DrawControl({ onAoi, apiRef }) {
  const map = useMap();

  useEffect(() => {
    const shapeOptions = { color: "#f0b84a", weight: 3, fillOpacity: 0.15 };
    const rect = new L.Draw.Rectangle(map, { showArea: false, shapeOptions });
    const poly = new L.Draw.Polygon(map, { showArea: false, allowIntersection: false, shapeOptions });
    apiRef.current = {
      rectangle() { poly.disable(); rect.enable(); },
      polygon() { rect.disable(); poly.enable(); },
    };
    const onCreated = (e) => {
      const kind = e.layerType; // "rectangle" | "polygon"
      const ring = e.layer.getLatLngs()[0];
      onAoi(aoiFromLatLngs(kind, ring)); // the drawn layer is not added to the map; state redraws it
    };
    map.on(L.Draw.Event.CREATED, onCreated);
    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      rect.disable();
      poly.disable();
      apiRef.current = null;
    };
  }, [map, onAoi, apiRef]);

  return null;
}
