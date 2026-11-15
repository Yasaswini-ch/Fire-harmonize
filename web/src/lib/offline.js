// "Save for offline": downloads everything the app needs into the same cache the service worker reads
// (public/sw.js), so the app opens with no signal. The list of built files comes from asset-manifest.json
// (written by the build), the data files from regions.json.
export const CACHE_NAME = "fire-harmonize-v1";

// Pure: every URL to save, relative to `base` (the app's base path, ending in "/").
//   manifest: Vite's build manifest ({ "src/main.jsx": { file, css, assets, imports, ... }, ... })
//   regions:  the region list from data/regions.json
export function urlsToCache(manifest, regions, base = "/") {
  const set = new Set([base, `${base}favicon.svg`, `${base}manifest.webmanifest`, `${base}globe/earth.jpg`, `${base}globe/sky-4k.jpg`]);
  for (const entry of Object.values(manifest ?? {})) {
    for (const f of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) if (f) set.add(`${base}${f}`);
  }
  set.add(`${base}data/regions.json`);
  set.add(`${base}data/meta.json`);
  for (const r of regions ?? []) set.add(`${base}data/cells_${r.id}.json`);
  return [...set];
}

export const offlineSupported = () => typeof caches !== "undefined" && "serviceWorker" in navigator;

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Returns { saved, failed: [url...] }. A file that cannot be fetched is reported, never skipped silently.
export async function saveForOffline(base = import.meta.env.BASE_URL, onProgress = () => {}) {
  const [manifest, regions] = await Promise.all([getJson(`${base}asset-manifest.json`), getJson(`${base}data/regions.json`)]);
  const urls = urlsToCache(manifest, regions, base);
  const cache = await caches.open(CACHE_NAME);
  const failed = [];
  let done = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "reload" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await cache.put(url, res);
    } catch {
      failed.push(url);
    }
    onProgress(++done, urls.length);
  }
  return { saved: urls.length - failed.length, failed };
}
