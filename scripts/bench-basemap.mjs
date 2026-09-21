// Reproducible basemap benchmark (development tool). Drives Chromium (Playwright, already a dev dependency) against a
// RUNNING Vigil server and measures, per scenario: time until the style is loaded, time until a country label is
// rendered, number of requests, transferred bytes and JS heap — cold and warm (second load, HTTP cache).
//   BASE_URL=http://localhost:3000 node scripts/bench-basemap.mjs
// Scenarios: the provider the server is configured with ("configured"), and — when BENCH_PMTILES_URL points at a real
// archive — the same page forced onto that archive through the dev-only localStorage override. Without a real archive
// the PMTiles scenario is reported as BLOCKED; numbers are never invented. Use `next start` (production build) for
// meaningful figures; `next dev` compiles on demand and is much slower.
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const pmtiles = process.env.BENCH_PMTILES_URL;
const runs = Number(process.env.BENCH_RUNS ?? 3);

async function once(browser, scenario, config, warmContext) {
  const context = warmContext ?? (await browser.newContext({ viewport: { width: 1280, height: 800 } }));
  const page = await context.newPage();
  if (config) await page.addInitScript((c) => localStorage.setItem("vigil.basemap.config", JSON.stringify(c)), config);
  let requests = 0;
  let bytes = 0;
  page.on("response", async (r) => {
    requests++;
    try {
      const len = Number(r.headers()["content-length"]);
      bytes += Number.isFinite(len) && len > 0 ? len : (await r.body()).length;
    } catch {
      /* redirects / aborted */
    }
  });
  const t0 = Date.now();
  await page.goto(`${base}/world`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__vigilMap?.isStyleLoaded() && window.__vigilMap.getLayer("clusters"), undefined, { timeout: 120000 });
  const styleMs = Date.now() - t0;
  let labelMs = null;
  try {
    await page.waitForFunction(() => {
      const m = window.__vigilMap;
      const id = m.getLayer("bm-places_country") ? "bm-places_country" : null;
      return id && m.queryRenderedFeatures({ layers: [id] }).length > 0;
    }, undefined, { timeout: 30000 });
    labelMs = Date.now() - t0;
  } catch {
    /* labels not rendered in time */
  }
  const provider = await page.evaluate(() => window.__vigilBasemap?.provider ?? "unknown");
  // Pan/zoom responsiveness: 20 eased camera steps, frame time via requestAnimationFrame.
  const frame = await page.evaluate(async () => {
    const m = window.__vigilMap;
    const times = [];
    let last = performance.now();
    for (let i = 0; i < 20; i++) {
      m.jumpTo({ center: [10 + i * 2, 45], zoom: 3 + (i % 5) * 0.4 });
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    times.sort((a, b) => a - b);
    return { median: +times[Math.floor(times.length / 2)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1) };
  });
  const heapMb = await page.evaluate(() => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null));
  await page.close();
  return { scenario, provider, styleMs, labelMs, requests, kb: Math.round(bytes / 1024), frameMedianMs: frame.median, frameP95Ms: frame.p95, heapMb };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const browser = await chromium.launch();
const rows = [];
async function scenario(name, config) {
  const cold = [];
  for (let i = 0; i < runs; i++) cold.push(await once(browser, `${name} (cold)`, config));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await once(browser, "warm-up", config, ctx);
  const warm = [];
  for (let i = 0; i < runs; i++) warm.push(await once(browser, `${name} (warm)`, config, ctx));
  await ctx.close();
  for (const [label, list] of [["cold", cold], ["warm", warm]]) {
    rows.push({ scenario: `${name} (${label})`, provider: list[0].provider, styleMs: median(list.map((r) => r.styleMs)), labelMs: median(list.map((r) => r.labelMs ?? 0)) || null, requests: median(list.map((r) => r.requests)), kb: median(list.map((r) => r.kb)), frameMedianMs: median(list.map((r) => r.frameMedianMs)), frameP95Ms: median(list.map((r) => r.frameP95Ms)), heapMb: median(list.map((r) => r.heapMb ?? 0)) || null });
  }
}
await scenario("configured", null);
if (pmtiles) await scenario("pmtiles", { pmtilesUrl: pmtiles });
else console.log("pmtiles scenario: BLOCKED — set BENCH_PMTILES_URL to a real Protomaps archive (see docs/PMTILES_DEPLOYMENT.md)");
await browser.close();
console.table(rows);
console.log(JSON.stringify(rows));
