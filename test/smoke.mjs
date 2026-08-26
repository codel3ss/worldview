/**
 * Boot smoke test: builds nothing, but serves the existing dist/ with the proxy
 * in front, loads it in a real browser with WebGL, forces the zero-network
 * "void" globe, and fails on any uncaught error or console error that is not
 * an expected offline feed failure.
 *
 *   npm run build && npm run smoke
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = Number(process.env.SMOKE_PORT || 4319);
const URL_BASE = `http://127.0.0.1:${PORT}`;
const children = [];

function serve(cmd, args, name) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT_PROXY: "8799", PROXY_ORIGIN: "http://127.0.0.1:8799" } });
  child.stdout.on('data', (d) => process.env.SMOKE_VERBOSE && console.log(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.env.SMOKE_VERBOSE && console.error(`[${name}] ${d}`));
  children.push(child);
  return child;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
  throw new Error(`server at ${url} never came up`);
}

const cleanup = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

serve('node', ['server/index.js'], 'proxy');
serve('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], 'web');
await waitForServer(URL_BASE);

const EXPECTED = [
  /Failed to load resource/i,
  /net::ERR/i,
  /ERR_(BLOCKED|PROXY|NAME|CONNECTION|TUNNEL)/i,
  /proxy not reachable/i,
  /feed failed|unreachable|timed out|502|504|Failed to fetch/i,
  /An error occurred while rendering/i,
  /openstreetmap|celestrak|adsb|usgs|nominatim/i,
];

const browser = await chromium.launch({
  // CHROME_PATH lets a sandbox point at a pre-installed browser; otherwise
  // Playwright resolves whatever `npx playwright install chromium` put down.
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}\n${err.stack ?? ''}`));
page.on('console', (msg) => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (EXPECTED.some((re) => re.test(text))) return;
  problems.push(`console: ${text}`);
});

await page.goto(`${URL_BASE}/#v=1&c=40.68920,-74.02210,9000,25,-35&m=void&s=normal`, {
  waitUntil: 'load',
  timeout: 60_000,
});

// Wait for the app to declare itself up.
await page.waitForFunction(() => Boolean(window.worldview?.viewer), null, { timeout: 45_000 });
await page.waitForTimeout(4000);

const report = await page.evaluate(() => ({
  mapStack: window.worldview.mapStack.current,
  sensor: window.worldview.sensor.current,
  layers: window.worldview.layers.map((l) => ({ id: l.id, enabled: l.enabled, state: l.state, note: l.stateNote })),
  bootRemoved: !document.getElementById('boot'),
  statusbar: document.querySelector('#statusbar')?.textContent?.trim().slice(0, 120),
  layerRows: document.querySelectorAll('#layer-list .layer-row').length,
  sensorChips: document.querySelectorAll('#sensor-list .chip').length,
  share: window.worldview.shareUrl(),
  canvas: (() => {
    const c = document.querySelector('#globe canvas');
    return c ? `${c.width}x${c.height}` : null;
  })(),
}));

// Exercise the sensor grades — a GLSL compile error only shows up on apply.
for (const mode of ['nightvision', 'thermal', 'crt', 'noir', 'normal']) {
  await page.evaluate((m) => window.worldview.setSensor(m), mode);
  await page.waitForTimeout(700);
}

await page.screenshot({ path: 'test/smoke.png' });
await browser.close();

console.log(JSON.stringify(report, null, 2));
if (problems.length) {
  console.error(`\n${problems.length} unexpected error(s):`);
  for (const p of new Set(problems)) console.error(` - ${p}`);
  cleanup();
  process.exit(1);
}
console.log('\nsmoke: OK');
cleanup();
process.exit(0);
