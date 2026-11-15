// Natural Earth polygons that cross the date line (Russia, Fiji, Antarctica) jump from lon +180 to -180, and
// Leaflet joins the points with a straight line across the whole map. This makes each ring continuous
// (longitudes may then run past +-180), closes rings that wrap a pole, and adds a copy shifted by 360 degrees
// so the part past the edge reappears on the other side of the map. Pure functions, tested.

export function unwrapRing(ring) {
  if (ring.length === 0) return ring;
  const out = [[ring[0][0], ring[0][1]]];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    out.push([ring[i][0] + offset, ring[i][1]]);
  }
  if (offset !== 0) { // the ring goes all the way around: it encloses a pole, so close it along that pole
    const pole = ring.reduce((a, p) => a + p[1], 0) / ring.length < 0 ? -90 : 90;
    out.push([out[out.length - 1][0], pole], [out[0][0], pole], [out[0][0], out[0][1]]);
  }
  return out;
}

const shift = (poly, dx) => poly.map((ring) => ring.map(([x, y]) => [x + dx, y]));

// geometry: GeoJSON Polygon or MultiPolygon. Returns a MultiPolygon without date-line jumps.
export function fixGeometry(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const out = [];
  for (const poly of polys) {
    const fixed = poly.map(unwrapRing);
    const xs = fixed[0].map((p) => p[0]);
    out.push(fixed);
    if (Math.max(...xs) > 180) out.push(shift(fixed, -360));
    if (Math.min(...xs) < -180) out.push(shift(fixed, 360));
  }
  return { type: "MultiPolygon", coordinates: out };
}

export function fixCollection(collection) {
  return { ...collection, features: collection.features.map((f) => ({ ...f, geometry: fixGeometry(f.geometry) })) };
}
