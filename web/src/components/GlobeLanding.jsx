import { useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { borderPositions } from "../lib/borders.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Full-screen landing globe: starfield, atmosphere glow, dashed satellite orbits with moving satellites
// (decoration, labelled as an illustration in the page), clickable region patches, and a camera that
// turns to the region a card is hovering. If public/globe/earth.jpg exists it is used as the Earth
// texture; if not, the globe is a plain dark sphere. Nothing here is data, only the region boxes.

const R = 1;
const toVec = (lat, lon, r = R) => {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
};
const toLatLon = (p) => {
  let lon = (Math.atan2(p.z, -p.x) * 180) / Math.PI - 180;
  if (lon < -180) lon += 360;
  return { lat: (Math.asin(p.y / p.length()) * 180) / Math.PI, lon };
};
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function patch([w, s, e, n], r = 1.003, steps = 14) {
  const pos = [];
  const idx = [];
  for (let j = 0; j <= steps; j++) {
    for (let i = 0; i <= steps; i++) pos.push(...toVec(s + ((n - s) * j) / steps, w + ((e - w) * i) / steps, r).toArray());
  }
  for (let j = 0; j < steps; j++) {
    for (let i = 0; i < steps; i++) {
      const a = j * (steps + 1) + i;
      idx.push(a, a + 1, a + steps + 1, a + 1, a + steps + 2, a + steps + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function outline([w, s, e, n], r = 1.005, steps = 28) {
  const pts = [];
  const lerp = (a, b, i) => a + ((b - a) * i) / steps;
  for (let i = 0; i < steps; i++) pts.push(toVec(s, lerp(w, e, i), r));
  for (let i = 0; i < steps; i++) pts.push(toVec(lerp(s, n, i), e, r));
  for (let i = 0; i < steps; i++) pts.push(toVec(n, lerp(e, w, i), r));
  for (let i = 0; i < steps; i++) pts.push(toVec(lerp(n, s, i), w, r));
  return new THREE.BufferGeometry().setFromPoints(pts);
}

// Deterministic pseudo-random so the sky is the same every load.
function stars(count = 2600) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const k = Math.sqrt(1 - u * u);
    pos.set([k * Math.cos(a) * 30, u * 30, k * Math.sin(a) * 30], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

const ATMOSPHERE = {
  vertexShader: "varying vec3 n; void main(){ n = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: "varying vec3 n; void main(){ float i = pow(0.72 - dot(n, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.30,0.55,1.0,1.0) * i; }",
};

// A small satellite: a body, two solar panels on arms, and a dish that faces the Earth. Local x points away from the
// Earth (the caller turns it with the orbit), so the dish sits on the -x side.
function satellite(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.05), new THREE.MeshBasicMaterial({ color }));
  g.add(body);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0x2f5fc4 });
  const frameMat = new THREE.LineBasicMaterial({ color: 0xcfe0ff });
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.004), new THREE.MeshBasicMaterial({ color: 0xcfe0ff }));
    arm.position.y = side * 0.035;
    const panelGeo = new THREE.BoxGeometry(0.06, 0.07, 0.004);
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.y = side * 0.085;
    panel.add(new THREE.LineSegments(new THREE.EdgesGeometry(panelGeo), frameMat));
    g.add(arm, panel);
  }
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.022, 16), new THREE.MeshBasicMaterial({ color: 0xe8eaf0 }));
  dish.rotation.z = Math.PI / 2; // the cone's tip (+y) turns to -x, toward the Earth
  dish.position.x = -0.04;
  g.add(dish);
  return g;
}

export default function GlobeLanding({ regions, hoverId, onHover, onPick, onTexture, ref }) {
  const mount = useRef(null);
  const api = useRef(null);
  const [tip, setTip] = useState(null);
  const cb = useRef({ onHover, onPick, onTexture });
  useEffect(() => { cb.current = { onHover, onPick, onTexture }; }, [onHover, onPick, onTexture]);

  useEffect(() => {
    const el = mount.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return undefined; // no WebGL: the page still works, the globe area stays empty
    }
    const still = reduced();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    const [w0, s0, e0, n0] = regions[0].bbox;
    camera.position.copy(toVec((s0 + n0) / 2 + 8, (w0 + e0) / 2, 2.6));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    scene.add(sun);
    const base0 = import.meta.env.BASE_URL;
    const earthMat = new THREE.MeshLambertMaterial({ color: 0x0d1626 });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), earthMat);
    scene.add(globe);
    new THREE.TextureLoader().load(`${base0}globe/earth.jpg`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      earthMat.map = tex;
      earthMat.color.set(0xffffff);
      earthMat.needsUpdate = true;
      cb.current.onTexture?.(true);
    }, undefined, () => cb.current.onTexture?.(false));

    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute("position", new THREE.BufferAttribute(borderPositions(1.0015), 3));
    scene.add(new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({ color: 0xc7d3ec, transparent: true, opacity: 0.4 })));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.14, 64, 48), new THREE.ShaderMaterial({ ...ATMOSPHERE, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    const starPoints = new THREE.Points(stars(), new THREE.PointsMaterial({ color: 0xcfd9ee, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
    scene.add(starPoints);
    const base = import.meta.env.BASE_URL;
    new THREE.TextureLoader().load(`${base}globe/sky-4k.jpg`, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 48, 32), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: 0x9aa4b8, depthWrite: false }));
      scene.add(sky);
      scene.remove(starPoints);
    });

    // Orbits and satellites: decoration only.
    const sats = [];
    [[1.38, 0.9, 0.2, 0.30, 0xf5b23a], [1.55, -0.5, 0.9, -0.21, 0x57e3ff], [1.75, 0.2, -0.7, 0.14, 0x57e3ff]].forEach(([rad, rx, rz, speed, color], i) => {
      const pts = Array.from({ length: 129 }, (_, k) => new THREE.Vector3(Math.cos((k / 128) * Math.PI * 2) * rad, 0, Math.sin((k / 128) * Math.PI * 2) * rad));
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 0.06, gapSize: 0.05, transparent: true, opacity: 0.4 }));
      ring.computeLineDistances();
      const grp = new THREE.Group();
      grp.rotation.set(rx, 0, rz);
      grp.add(ring);
      const sat = satellite(color);
      grp.add(sat);
      scene.add(grp);
      sats.push({ sat, rad, speed, phase: i * 2 });
    });

    const regionObjs = new Map();
    for (const r of regions) {
      const fill = new THREE.Mesh(patch(r.bbox), new THREE.MeshBasicMaterial({ color: 0xe9b44c, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
      const line = new THREE.LineLoop(outline(r.bbox), new THREE.LineBasicMaterial({ color: 0xf0cf7a }));
      scene.add(fill, line);
      regionObjs.set(r.id, { fill, line, bbox: r.bbox });
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 2.4;
    controls.maxDistance = 6;
    controls.minPolarAngle = Math.PI * 0.2;
    controls.maxPolarAngle = Math.PI * 0.8;
    controls.enableDamping = !still;
    controls.autoRotate = !still;
    controls.autoRotateSpeed = 0.5;
    let focus = null; // unit direction the camera is turning towards
    controls.addEventListener("start", () => { controls.autoRotate = false; focus = null; });

    let shift = 1; // 1 = globe low on the screen, rising from the bottom edge; 0 = centred (during the fly-in)
    const applyOffset = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      camera.aspect = w / h;
      if (w > 900) camera.setViewOffset(w, h, 0, -h * 0.42 * shift, w, h);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    };
    const size = () => {
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      applyOffset();
    };
    const ro = new ResizeObserver(size);
    ro.observe(el);
    size();

    const ray = new THREE.Raycaster();
    const dom = renderer.domElement;
    const hit = (e) => {
      const rect = dom.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
      const h = ray.intersectObject(globe)[0];
      if (!h) return null;
      const { lat, lon } = toLatLon(h.point);
      return regions.find(({ bbox: [w, s, e2, n] }) => lon >= w && lon <= e2 && lat >= s && lat <= n) ?? null;
    };
    let down = null;
    let flight = null;
    const onDown = (e) => { down = [e.clientX, e.clientY]; };
    const onUp = (e) => {
      if (!flight && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
        const r = hit(e);
        if (r) cb.current.onPick(r);
      }
    };
    const onMove = (e) => {
      if (flight) return;
      const r = hit(e);
      dom.style.cursor = r ? "pointer" : "grab";
      setTip(r ? { name: r.name, x: e.offsetX, y: e.offsetY } : null);
      cb.current.onHover(r ? r.id : null);
    };
    const onLeave = () => { setTip(null); cb.current.onHover(null); };
    dom.addEventListener("pointerdown", onDown);
    dom.addEventListener("pointerup", onUp);
    dom.addEventListener("pointermove", onMove);
    dom.addEventListener("pointerleave", onLeave);

    let raf = 0;
    const clock = new THREE.Clock();
    const tick = () => {
      const dt = clock.getDelta();
      if (!still) for (const s of sats) { s.phase += s.speed * dt; s.sat.position.set(Math.cos(s.phase) * s.rad, 0, Math.sin(s.phase) * s.rad); s.sat.rotation.y = -s.phase; }
      if (flight) {
        const p = Math.min(1, (performance.now() - flight.t0) / flight.ms);
        const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2; // ease in-out
        const step = new THREE.Quaternion().slerp(flight.q, e);
        camera.position.copy(flight.dir0.clone().applyQuaternion(step).multiplyScalar(flight.len0 + (flight.len1 - flight.len0) * e));
        shift = 1 - e;
        applyOffset();
        if (p >= 1) { const done = flight.done; flight = null; done(); }
      } else if (focus) {
        const target = focus.clone().multiplyScalar(camera.position.length());
        camera.position.lerp(target, still ? 1 : 0.06);
        if (camera.position.distanceTo(target) < 0.01) focus = null;
      }
      sun.position.copy(camera.position).add(new THREE.Vector3(2, 2, 2));
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    api.current = {
      // Turn to the region and zoom in; the centre of the box ends up in the middle of the screen.
      fly(region, ms, done) {
        const [w, s, e, n] = region.bbox;
        const dir1 = toVec((s + n) / 2, (w + e) / 2, 1).normalize();
        const dir0 = camera.position.clone().normalize();
        controls.autoRotate = false;
        controls.enabled = false;
        controls.minDistance = 1.2;
        focus = null;
        setTip(null);
        flight = { t0: performance.now(), ms, dir0, q: new THREE.Quaternion().setFromUnitVectors(dir0, dir1), len0: camera.position.length(), len1: 1.9, done };
      },
      highlight(id) {
        if (flight) return;
        for (const [rid, o] of regionObjs) {
          o.fill.material.opacity = rid === id ? 0.5 : 0.22;
          o.line.material.color.set(rid === id ? 0xfff0b8 : 0xf0cf7a);
        }
        const o = id && regionObjs.get(id);
        if (o) {
          const [w, s, e, n] = o.bbox;
          focus = toVec((s + n) / 2, (w + e) / 2, 1).normalize();
          controls.autoRotate = false;
        }
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener("pointerdown", onDown);
      dom.removeEventListener("pointerup", onUp);
      dom.removeEventListener("pointermove", onMove);
      dom.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      scene.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      renderer.dispose();
      el.removeChild(dom);
      api.current = null;
    };
  }, [regions]);

  useEffect(() => { api.current?.highlight(hoverId); }, [hoverId]);
  useImperativeHandle(ref, () => ({ fly: (region, ms, done) => (api.current ? api.current.fly(region, ms, done) : done()) }), []);

  return (
    <div className="gl-wrap" ref={mount}>
      {tip && <div className="gl-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.name}</div>}
    </div>
  );
}
