import { useEffect, useMemo, useRef, useState } from "react";
import { interpolateInferno } from "d3-scale-chromatic";
import * as THREE from "three";
import { borderPositions } from "../lib/borders.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// 3D globe: region outlines (click to pick a region) and one glowing point per 0.25 degree cell,
// coloured by that month's count. A slider and a play button scrub through the record. Optional
// extra: the app works without it. The colour ramp is Inferno (colour-blind safe, same family as the
// calendar). Auto-rotation is off when the user prefers reduced motion.

const R = 1;
const toVec = (lat, lon, r = R) => {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
};
const toLatLon = (p) => {
  const lat = (Math.asin(p.y / p.length()) * 180) / Math.PI;
  let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
  if (lon < -180) lon += 360;
  return { lat, lon };
};

function outline([w, s, e, n], r, steps = 24) {
  const pts = [];
  const lerp = (a, b, i) => a + ((b - a) * i) / steps;
  for (let i = 0; i < steps; i++) pts.push(toVec(s, lerp(w, e, i), r));
  for (let i = 0; i < steps; i++) pts.push(toVec(lerp(s, n, i), e, r));
  for (let i = 0; i < steps; i++) pts.push(toVec(n, lerp(e, w, i), r));
  for (let i = 0; i < steps; i++) pts.push(toVec(lerp(n, s, i), w, r));
  return pts;
}

function graticule() {
  const pts = [];
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 5) pts.push(toVec(lat, lon, 1.001), toVec(lat, lon + 5, 1.001));
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -90; lat < 90; lat += 5) pts.push(toVec(lat, lon, 1.001), toVec(lat + 5, lon, 1.001));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

const LUT = Array.from({ length: 64 }, (_, i) => new THREE.Color(interpolateInferno(0.18 + (0.82 * i) / 63)));
const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Count that maps to the top of the ramp: the 99th percentile of the non-zero cell-months, so a few
// extreme months do not wash everything else out.
function rampMax(cells) {
  const vals = [];
  for (const c of cells) for (let i = 0; i < c.v.length; i += 3) if (c.v[i] > 0) vals.push(c.v[i]);
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length * 0.99)] || 1;
}

function sourceLabel(d, i) {
  if (i >= d.provisionalFrom) return "provisional (near real time)";
  if (i < d.firstViirsIndex) return "MODIS-estimated (approximate)";
  return "VIIRS native";
}

export default function GlobeView({ regions, cellsData, activeRegion, onPick }) {
  const mount = useRef(null);
  const three = useRef(null);
  const [failed, setFailed] = useState(null);
  const [idx, setIdx] = useState(null);
  const [playing, setPlaying] = useState(false);
  const last = cellsData ? cellsData.months.length - 1 : 0;
  const month = idx === null ? last : Math.min(idx, last);
  const max = useMemo(() => (cellsData ? rampMax(cellsData.cells) : 1), [cellsData]);
  const onPickRef = useRef(onPick);
  useEffect(() => { onPickRef.current = onPick; }, [onPick]);

  // Scene: built once.
  useEffect(() => {
    const el = mount.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      setFailed(`WebGL is not available (${err.message}). The map and region buttons still work.`);
      return undefined;
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0.6, 3.1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    const earthMat = new THREE.MeshBasicMaterial({ color: 0x0b1220 });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48), earthMat);
    scene.add(globe);
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}globe/earth.jpg`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      earthMat.map = tex;
      earthMat.color.set(0x9aa6bd); // dimmed so the hotspot colours stay the brightest thing on the globe
      earthMat.needsUpdate = true;
    }); // if the file is missing the sphere simply stays dark
    scene.add(new THREE.LineSegments(graticule(), new THREE.LineBasicMaterial({ color: 0x3a4a63, transparent: true, opacity: 0.6 })));
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute("position", new THREE.BufferAttribute(borderPositions(1.002), 3));
    scene.add(new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0xc7d3ec, transparent: true, opacity: 0.45 })));
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.06, 48, 32),
      new THREE.MeshBasicMaterial({ color: 0x3b6fd4, transparent: true, opacity: 0.12, side: THREE.BackSide }),
    );
    scene.add(halo);

    const outlines = new Map();
    for (const r of regions) {
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outline(r.bbox, 1.004)), new THREE.LineBasicMaterial({ color: 0x8fb0ff }));
      scene.add(line);
      outlines.set(r.id, line);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 6;
    controls.enableDamping = !prefersReducedMotion();
    controls.autoRotate = !prefersReducedMotion();
    controls.autoRotateSpeed = 0.6;
    controls.addEventListener("start", () => { controls.autoRotate = false; });

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Click (not drag) on the globe picks the region whose box contains the point.
    const ray = new THREE.Raycaster();
    let down = null;
    const dom = renderer.domElement;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onUp = (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = dom.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const hit = ray.intersectObject(globe)[0];
      if (!hit) return;
      const { lat, lon } = toLatLon(hit.point);
      const region = regions.find(({ bbox: [w, s, e2, n] }) => lon >= w && lon <= e2 && lat >= s && lat <= n);
      if (region) onPickRef.current(region);
    };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    three.current = { scene, camera, controls, outlines, points: null };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
      renderer.dispose();
      el.removeChild(dom);
      three.current = null;
    };
  }, [regions]);

  // Highlight the active region and turn the camera towards it.
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    for (const [id, line] of t.outlines) line.material.color.set(id === activeRegion?.id ? 0xffd24a : 0x8fb0ff);
    if (activeRegion) {
      const [w, s, e, n] = activeRegion.bbox;
      t.camera.position.copy(toVec((s + n) / 2, (w + e) / 2, 3.1));
      t.controls.autoRotate = false;
    }
  }, [activeRegion, failed]);

  // Points: rebuilt when the region's data changes.
  useEffect(() => {
    const t = three.current;
    if (!t || !cellsData) return undefined;
    const n = cellsData.cells.length;
    const pos = new Float32Array(n * 3);
    cellsData.cells.forEach((c, i) => toVec(c.lat, c.lon, 1.006).toArray(pos, i * 3));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ size: 0.022, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(geo, mat);
    t.scene.add(pts);
    t.points = pts;
    return () => { t.scene.remove(pts); geo.dispose(); mat.dispose(); t.points = null; };
  }, [cellsData, failed]);

  // Colours for the chosen month.
  useEffect(() => {
    const t = three.current;
    if (!t?.points || !cellsData) return;
    const col = t.points.geometry.getAttribute("color");
    cellsData.cells.forEach((c, i) => {
      const v = c.v[month];
      const k = v > 0 ? LUT[Math.min(63, Math.round(Math.sqrt(Math.min(v / max, 1)) * 63))] : null;
      col.setXYZ(i, k ? k.r : 0, k ? k.g : 0, k ? k.b : 0);
    });
    col.needsUpdate = true;
  }, [month, cellsData, max, failed]);

  // Time-lapse: user-started, one month per tick, loops.
  useEffect(() => {
    if (!playing || !cellsData) return undefined;
    const id = setInterval(() => setIdx((i) => ((i === null ? last : i) + 1) % (last + 1)), 140);
    return () => clearInterval(id);
  }, [playing, cellsData, last]);

  if (failed) return <section className="panel notice warn" role="status"><h2>Globe</h2><p>{failed}</p></section>;

  return (
    <section className="panel globe" aria-label="Globe">
      <h2>Globe</h2>
      <div className="globe-canvas" ref={mount} role="img"
        aria-label="3D globe of fire detections. Drag to rotate, scroll to zoom, click a boxed region to select it. The region buttons and the slider below do the same without the mouse." />
      {cellsData ? (
        <div className="globe-controls">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>{playing ? "Pause" : "Play"}</button>
          <label className="grow"><span>Month: {cellsData.months[month]}</span>
            <input type="range" min={0} max={last} value={month}
              onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }} />
          </label>
        </div>
      ) : <p className="hint">Select a region to see its detections.</p>}
      {cellsData && <p className="hint">Source of this month: {sourceLabel(cellsData, month)}. Colour = detections per 0.25 degree cell (square-root scale).</p>}
    </section>
  );
}
