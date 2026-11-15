import { useEffect, useState } from "react";
import { GeoJSON, MapContainer, Polygon, Rectangle, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { feature } from "topojson-client";
import { fixCollection } from "../lib/antimeridian.js";
import { cellsAt, hotspotColor } from "../lib/hotspots.js";
import DrawControl from "./DrawControl.jsx";

const toLatLngBounds = ([w, s, e, n]) => [[s, w], [n, e]];
const asBounds = (a) => (a.type === "bbox" ? [[a.south, a.west], [a.north, a.east]] : null);
const asRing = (a) => a.coordinates.map(([lon, lat]) => [lat, lon]);

function Shape({ aoi, pathOptions }) {
  return aoi.type === "bbox"
    ? <Rectangle bounds={asBounds(aoi)} pathOptions={pathOptions} />
    : <Polygon positions={asRing(aoi)} pathOptions={pathOptions} />;
}

// On load and on every region change the map fits the region box with 10 percent padding and will not zoom out more than two
// levels beyond that. It also re-fits (same padding) whenever `fit.nonce` changes: presets and the coordinate Apply button.
function FitController({ fit, region }) {
  const map = useMap();
  const regionId = region?.id;
  useEffect(() => {
    if (!region) return;
    map.setMinZoom(0);
    map.fitBounds(L.latLngBounds(toLatLngBounds(region.bbox)).pad(0.1), { animate: false });
    map.setMinZoom(Math.max(0, map.getZoom() - 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the region itself changes
  }, [map, regionId]);
  useEffect(() => {
    if (fit) map.fitBounds(L.latLngBounds(toLatLngBounds(fit.bounds)).pad(0.1), { animate: false });
  }, [map, fit]);
  return null;
}

const LAND = { color: "#6b7d99", weight: 0.8, fillColor: "#1d2a3d", fillOpacity: 1 };

// Vector basemap from Natural Earth (world-atlas 1:50m): land and country borders drawn by Leaflet itself.
// No tile server, no API key, and it keeps working offline. Loaded on demand because the file is large.
function Basemap() {
  const [countries, setCountries] = useState(null);
  useEffect(() => {
    let cancelled = false;
    import("world-atlas/countries-50m.json").then((m) => {
      const topo = m.default;
      if (!cancelled) setCountries(fixCollection(feature(topo, topo.objects.countries)));
    });
    return () => { cancelled = true; };
  }, []);
  return countries ? <GeoJSON data={countries} style={LAND} pane="tilePane" attribution="Borders: Natural Earth" interactive={false} /> : null;
}

// One square per grid cell with detections in the chosen month, drawn in its own pane between the borders and the
// area outlines. `hotspots` is { data, index, max } or null (data still loading).
function HotspotLayer({ hotspots }) {
  const map = useMap();
  const group = useState(() => L.layerGroup())[0];
  useEffect(() => {
    if (!map.getPane("hotspots")) {
      const pane = map.createPane("hotspots");
      pane.style.zIndex = 350;
      pane.style.pointerEvents = "none";
    }
    group.addTo(map);
    return () => { group.remove(); };
  }, [map, group]);
  useEffect(() => {
    group.clearLayers();
    if (!hotspots) return;
    const { data, index, max } = hotspots;
    const half = (data.cellSize ?? 0.25) / 2;
    for (const c of cellsAt(data, index)) {
      L.rectangle([[c.lat - half, c.lon - half], [c.lat + half, c.lon + half]],
        { pane: "hotspots", stroke: false, fillColor: hotspotColor(c.v[index], max), fillOpacity: 0.85, interactive: false }).addTo(group);
    }
  }, [group, hotspots]);
  return null;
}

export default function MapView({ regions, region = null, aoi, activeAoi, fit, onAoi, drawApi, hotspots = null }) {
  return (
    <MapContainer
      bounds={toLatLngBounds(fit.bounds)}
      className="map"
      preferCanvas
      maxBounds={[[-90, -180], [90, 180]]}
      maxBoundsViscosity={1}
      zoomAnimation={false}
      fadeAnimation={false}
      markerZoomAnimation={false}
      inertia={false}
    >
      <Basemap />
      <HotspotLayer hotspots={hotspots} />
      {regions.map((r) => (
        <Rectangle key={r.id} bounds={toLatLngBounds(r.bbox)} pathOptions={{ color: "#c9d2e0", weight: 2, dashArray: "8 6", fill: false }}>
          <Tooltip sticky>{r.name} (processed region)</Tooltip>
        </Rectangle>
      ))}
      {/* what the user drew or typed, dashed; the part that has data, filled */}
      <Shape aoi={aoi} pathOptions={{ color: "#f0b84a", weight: 3, dashArray: "4 6", fill: false }} />
      {activeAoi && <Shape aoi={activeAoi} pathOptions={{ color: "#f0b84a", weight: 3, fillColor: "#f0b84a", fillOpacity: 0.25 }} />}
      <DrawControl onAoi={onAoi} apiRef={drawApi} />
      <FitController fit={fit} region={region} />
    </MapContainer>
  );
}
