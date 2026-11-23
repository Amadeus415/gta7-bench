#!/usr/bin/env node
// Loads the game in headless Chrome and reports what a player would run into:
// console errors, frame rate, the test hook's state, and a screenshot.
//
//   node tools/check.mjs                              load, wait, save screenshot.png
//   node tools/check.mjs --play "F W:3000 F W:2000"   then press keys: KEY or KEY:holdMilliseconds

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function serve(dir) {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (urlPath === '/favicon.ico') return response.writeHead(204).end();
    const file = path.join(dir, urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() });
    });
  });
}

// "W" -> "KeyW", "1" -> "Digit1"; names like Space, ShiftLeft, ArrowUp pass through.
function keyName(key) {
  if (/^[a-z]$/i.test(key)) return 'Key' + key.toUpperCase();
  if (/^[0-9]$/.test(key)) return 'Digit' + key;
  if (/^shift$/i.test(key)) return 'ShiftLeft';
  return key;
}

/** Open the game in `dir` and return handles for driving it. */
export async function openGame(dir, { width = 1280, height = 720 } = {}) {
  const site = await serve(path.resolve(dir));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      `--window-size=${width},${height}`,
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  const errors = [];
  page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('requestfailed', (request) => errors.push(`request failed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      errors.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });

  await page.goto(site.url, { waitUntil: 'load', timeout: 30000 }).catch((error) => {
    errors.push(`load failed: ${error.message}`);
  });

  const game = {
    page,
    errors,

    /** The test hook's state, or null if the hook is missing or throws. */
    state: () =>
      page
        .evaluate(() => {
          const s = window.__bench.state();
          return { mode: s.mode, x: s.x, y: s.y, z: s.z, speed: s.speed };
        })
        .catch(() => null),

    /** Frames per second, counted over `ms` of requestAnimationFrame. */
    fps: (ms = 3000) =>
      page.evaluate(
        (ms) =>
          new Promise((resolve) => {
            let frames = 0;
            const start = performance.now();
            const tick = (now) => {
              frames++;
              if (now - start < ms) requestAnimationFrame(tick);
              else resolve(Math.round((frames * 1000) / (now - start)));
            };
            requestAnimationFrame(tick);
          }),
        ms,
      ),

    down: (key) => page.keyboard.down(keyName(key)),
    up: (key) => page.keyboard.up(keyName(key)),

    /** Hold one or more keys ("W" or "W+D") for `ms`, then release them. */
    async hold(keys, ms = 80) {
      const names = keys.split('+');
      for (const key of names) await game.down(key);
      await sleep(ms);
      for (const key of names.reverse()) await game.up(key);
    },

    shot: (file) => page.screenshot({ path: file }),

    async close() {
      await browser.close();
      site.close();
    },
  };
  return game;
}

const round = (state) =>
  state &&
  Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]),
  );

async function main() {
  const args = process.argv.slice(2);
  const playAt = args.indexOf('--play');
  const steps = playAt >= 0 ? args[playAt + 1].trim().split(/\s+/) : [];
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const game = await openGame(dir);
  await sleep(3000);
  console.log('frames per second:', await game.fps(2000));
  console.log('state after load: ', JSON.stringify(round(await game.state())));

  for (const step of steps) {
    const [keys, ms] = step.split(':');
    await game.hold(keys, ms ? Number(ms) : 80);
    await sleep(400);
    console.log(`state after ${step}:`.padEnd(19), JSON.stringify(round(await game.state())));
  }

  const file = path.join(dir, 'screenshot.png');
  await game.shot(file);
  console.log('screenshot saved: ', file);
  console.log(game.errors.length ? `errors (${game.errors.length}):` : 'errors: none');
  for (const error of game.errors.slice(0, 20)) console.log('  ' + error);
  await game.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('check failed:', error.message);
    process.exit(1);
  });
}
