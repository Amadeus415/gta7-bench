#!/usr/bin/env node
// Automated play-test: the same ten checks for every entry.
//
//   node harness/score.mjs                 score every directory in runs/
//   node harness/score.mjs fable-5.2       score one
//
// Writes results/<entry>/auto.json and four screenshots per entry.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from '../kit/tools/check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const valid = (s) =>
  s && (s.mode === 'foot' || s.mode === 'car') && [s.x, s.y, s.z, s.speed].every(Number.isFinite);
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const heading = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const degreesBetween = (h1, h2) =>
  Math.abs((((h2 - h1) * 180) / Math.PI + 540) % 360 - 180);

/** Hold keys for `ms`, sampling the player's state every 100 ms. */
async function holdAndTrack(game, keys, ms) {
  const names = keys.split('+');
  const track = [];
  for (const key of names) await game.down(key);
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const state = await game.state();
    if (valid(state)) track.push(state);
  }
  for (const key of names) await game.up(key);
  return track;
}

/** How many distinct colours a 64x36 thumbnail of the page has; a blank page has 1. */
async function colourCount(game) {
  const png = await game.page.screenshot({ encoding: 'base64' });
  const helper = await game.page.browser().newPage();
  const count = await helper.evaluate(async (png) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = new OffscreenCanvas(64, 36);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 64, 36);
    const pixels = context.getImageData(0, 0, 64, 36).data;
    const colours = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      colours.add((pixels[i] >> 4) + ',' + (pixels[i + 1] >> 4) + ',' + (pixels[i + 2] >> 4));
    }
    return colours.size;
  }, png);
  await helper.close();
  return count;
}

/** The browser's own frame rate on an empty page: 60 normally, 30 in low power mode. */
async function idleFrameRate(game) {
  const blank = await game.page.browser().newPage();
  await blank.bringToFront();
  const rate = await blank.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = (now) => {
          frames++;
          if (now - start < 1500) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (now - start)));
        };
        requestAnimationFrame(tick);
      }),
  );
  await blank.close();
  await game.page.bringToFront();
  return rate;
}

function codeStats(dir) {
  let files = 0;
  let lines = 0;
  let bytes = 0;
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      const relative = path.relative(dir, file);
      if (/^(vendor|tools|node_modules)(\/|$)/.test(relative) || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) walk(file);
      else if (/\.(html|js|mjs|css)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        files++;
        lines += text.split('\n').length;
        bytes += text.length;
      }
    }
  };
  walk(dir);
  return { files, lines, bytes };
}

async function score(name) {
  const dir = path.join(ROOT, 'runs', name);
  const out = path.join(ROOT, 'results', name);
  fs.mkdirSync(out, { recursive: true });
  const checks = [];
  const check = (id, label, pass, detail) => {
    checks.push({ id, label, pass: Boolean(pass), detail });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
  };
  console.log(name);

  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    for (const label of LABELS) check(label[0], label[1], false, 'no index.html');
    return finish();
  }

  const game = await openGame(dir);
  await sleep(4000);

  // 1-3: it loads, it draws, the hook answers.
  check('loads', LABELS[0][1], game.errors.length === 0, game.errors[0]);
  const colours = await colourCount(game);
  check('renders', LABELS[1][1], colours >= 6, `${colours} colours`);
  await game.shot(path.join(out, '1-start.jpg'));
  const start = await game.state();
  check('hook', LABELS[2][1], valid(start) && start.mode === 'foot', JSON.stringify(start));

  // 4: F gets into the car parked next to the player.
  await game.hold('F');
  await sleep(1500);
  let inCar = await game.state();
  check('enter', LABELS[3][1], inCar?.mode === 'car', `mode ${inCar?.mode}`);

  // 5: W drives. 6: adding D changes the direction of travel.
  const straight = await holdAndTrack(game, 'W', 3000);
  const driven = straight.length > 1 ? distance(straight[0], straight.at(-1)) : 0;
  const top = Math.max(0, ...straight.map((s) => Math.abs(s.speed)));
  check(
    'drive',
    LABELS[4][1],
    inCar?.mode === 'car' && driven >= 8,
    `${driven.toFixed(1)} m in 3 s, top ${top.toFixed(1)} m/s`,
  );
  await game.down('W');
  await game.shot(path.join(out, '2-driving.jpg'));
  await game.up('W');
  const turn = await holdAndTrack(game, 'W+D', 2000);
  let turned = 0;
  if (straight.length > 6 && turn.length > 6) {
    turned = degreesBetween(
      heading(straight.at(-6), straight.at(-1)),
      heading(turn.at(-6), turn.at(-1)),
    );
  }
  check(
    'steer',
    LABELS[5][1],
    inCar?.mode === 'car' && turned >= 15,
    `${turned.toFixed(0)} degrees`,
  );

  // 7: stop, then F gets out.
  await game.hold('Space', 2000);
  for (let i = 0; i < 20 && Math.abs((await game.state())?.speed ?? 0) > 0.5; i++) await sleep(200);
  await game.hold('F');
  await sleep(1500);
  const onFoot = await game.state();
  check('exit', LABELS[6][1], inCar?.mode === 'car' && onFoot?.mode === 'foot', `mode ${onFoot?.mode}`);

  // 8: W walks.
  const walk = await holdAndTrack(game, 'W', 3000);
  const walked = walk.length > 1 ? distance(walk[0], walk.at(-1)) : 0;
  check(
    'walk',
    LABELS[7][1],
    onFoot?.mode === 'foot' && walked >= 2,
    `${walked.toFixed(1)} m in 3 s`,
  );
  await game.shot(path.join(out, '3-on-foot.jpg'));

  // 9: frame rate. In low power mode Chrome itself is capped at 30, so the bar is the
  // lower of 30 and 90% of what an empty page manages.
  const idle = await idleFrameRate(game);
  const fps = await game.fps(3000);
  check('fps', LABELS[8][1], fps >= Math.min(30, 0.9 * idle), `${fps} fps, browser limit ${idle}`);

  // 10: a longer session with mixed input stays up and error-free.
  const before = game.errors.length;
  await game.hold('W+Shift', 2500);
  await game.hold('Space', 100);
  await game.hold('A', 1200);
  await game.hold('S', 1200);
  await game.hold('D', 1200);
  await sleep(22000);
  const end = await game.state();
  const stillRunning = (await game.fps(1000)) > 0;
  check(
    'soak',
    LABELS[9][1],
    game.errors.length === before && valid(end) && stillRunning,
    game.errors[before],
  );
  await game.shot(path.join(out, '4-later.jpg'));

  const errors = game.errors.slice(0, 20);
  await game.close();
  return finish({ fps, idle, errors });

  function finish(extra = {}) {
    const result = {
      name,
      passed: checks.filter((c) => c.pass).length,
      total: checks.length,
      checks,
      code: codeStats(dir),
      ...extra,
    };
    fs.writeFileSync(path.join(out, 'auto.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(`  ${result.passed}/${result.total}\n`);
    return result;
  }
}

const LABELS = [
  ['loads', 'Loads without errors'],
  ['renders', 'Draws a scene'],
  ['hook', 'Test hook reports the player on foot'],
  ['enter', 'F gets into the car'],
  ['drive', 'W drives the car'],
  ['steer', 'D steers the car'],
  ['exit', 'F gets out again'],
  ['walk', 'W walks'],
  ['fps', 'Holds 30 frames per second'],
  ['soak', '30 more seconds of play without errors'],
];

const names = process.argv.slice(2);
const entries = names.length
  ? names
  : fs
      .readdirSync(path.join(ROOT, 'runs'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name);
for (const name of entries) await score(name);
