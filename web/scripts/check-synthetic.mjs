// Runs before `npm run build` (npm "prebuild"). Exits 1 if public/data/meta.json is marked synthetic,
// unless ALLOW_SYNTHETIC=1. Optional argument: path to a meta.json (used by the tests).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkMeta } from "../src/lib/synthetic.js";

const path = process.argv[2] ?? fileURLToPath(new URL("../public/data/meta.json", import.meta.url));

if (!existsSync(path)) {
  console.warn(`check-synthetic: ${path} not found, nothing to check. The built app will show a missing-file error until the pipeline has been run.`);
  process.exit(0);
}

let meta;
try {
  meta = JSON.parse(readFileSync(path, "utf-8"));
} catch (err) {
  console.error(`BUILD BLOCKED: ${path} is not valid JSON (${err.message}), so it cannot be checked for synthetic data.`);
  process.exit(1);
}
if (meta === null || typeof meta !== "object" || Array.isArray(meta)) {
  console.error(`BUILD BLOCKED: ${path} does not hold a JSON object, so it cannot be checked for synthetic data.`);
  process.exit(1);
}

const result = checkMeta(meta, process.env, path);
if (result.message) (result.ok ? console.warn : console.error)(result.message);
process.exit(result.ok ? 0 : 1);
