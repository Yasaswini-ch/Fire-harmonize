// Guard against fixture data shipping as real data. Pure (no fs, no React) so the banner, the build script
// and the tests all use the same rule.
export const SYNTHETIC_BANNER_TEXT = "SYNTHETIC TEST DATA, NOT REAL FIRE DATA";

// Only a missing key or an explicit false counts as real. "true", 1 or "yes" all count as synthetic, so a
// sloppy edit cannot let fixture data through.
export const isSynthetic = (meta) => meta != null && meta.synthetic !== undefined && meta.synthetic !== false;

// { ok, message }. ok = false blocks the build. Only the exact string "1" in ALLOW_SYNTHETIC overrides.
export function checkMeta(meta, env = {}, path = "web/public/data/meta.json") {
  if (!isSynthetic(meta)) return { ok: true, message: null };
  if (env.ALLOW_SYNTHETIC === "1") {
    return { ok: true, message: `WARNING: ${path} has "synthetic": true. ALLOW_SYNTHETIC=1 is set, so this build contains SYNTHETIC TEST DATA. Do not deploy it.` };
  }
  return {
    ok: false,
    message: [
      `BUILD BLOCKED: ${path} has "synthetic": true. That is fixture data, not real fire data, and it must not be deployed.`,
      "To ship, replace it with real output: run pipeline/01_fetch.py to 04_export.py on real FIRMS data (04_export.py writes \"synthetic\": false).",
      'To build it anyway for local testing only, set ALLOW_SYNTHETIC=1 (PowerShell: $env:ALLOW_SYNTHETIC="1"; npm run build).',
    ].join("\n"),
  };
}
