import { mesh } from "topojson-client";
import world from "world-atlas/countries-110m.json";

// Country and coast lines (Natural Earth 110m via world-atlas) as flat xyz pairs for THREE.LineSegments on a
// sphere of the given radius. Long segments are split so the lines follow the curve instead of cutting
// through the globe. Same lon/lat to xyz mapping as the globes use.
const STEP_DEG = 2;

function xyz(lat, lon, r) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}

export function borderPositions(radius) {
  const out = [];
  for (const line of mesh(world, world.objects.countries).coordinates) {
    for (let i = 0; i < line.length - 1; i++) {
      const [lon0, lat0] = line[i];
      const [lon1, lat1] = line[i + 1];
      if (Math.abs(lon1 - lon0) > 180) continue; // a line crossing the antimeridian: skip rather than draw across the map
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(lon1 - lon0), Math.abs(lat1 - lat0)) / STEP_DEG));
      for (let k = 0; k < n; k++) {
        out.push(...xyz(lat0 + ((lat1 - lat0) * k) / n, lon0 + ((lon1 - lon0) * k) / n, radius));
        out.push(...xyz(lat0 + ((lat1 - lat0) * (k + 1)) / n, lon0 + ((lon1 - lon0) * (k + 1)) / n, radius));
      }
    }
  }
  return new Float32Array(out);
}
