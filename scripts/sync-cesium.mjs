/**
 * Cesium ships its Workers, shaders and widget assets as static files that must
 * be fetched at runtime from CESIUM_BASE_URL (see index.html). Copying them
 * into public/ once is simpler and more predictable than a bundler plugin: dev
 * and build both just serve public/.
 *
 * Runs on postinstall and before every build. Safe to re-run.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIRS = ['Workers', 'Assets', 'Widgets', 'ThirdParty'];

const cesiumRoot = path.join(path.dirname(require.resolve('cesium/package.json')), 'Build', 'Cesium');
const dest = path.join(process.cwd(), 'public', 'cesium');

const stamp = path.join(dest, '.version');
const { version } = require('cesium/package.json');

try {
  if ((await fs.readFile(stamp, 'utf8')).trim() === version) {
    console.log(`[cesium] public/cesium already at ${version}`);
    process.exit(0);
  }
} catch {
  /* first run */
}

await fs.rm(dest, { recursive: true, force: true });
await fs.mkdir(dest, { recursive: true });
for (const dir of DIRS) {
  await fs.cp(path.join(cesiumRoot, dir), path.join(dest, dir), { recursive: true });
}
await fs.writeFile(stamp, version);
console.log(`[cesium] staged ${DIRS.join(', ')} for ${version} -> public/cesium`);
