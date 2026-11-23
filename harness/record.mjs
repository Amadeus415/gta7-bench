#!/usr/bin/env node
// Records a short gameplay video of each entry: jump, get in the car, drive a route
// around a few blocks, get out, run around. Keyboard only, the same controls a player has.
//
//   node harness/record.mjs                 record every entry that has a route below
//   node harness/record.mjs opus-5.5        record one
//
// Writes results/<entry>/gameplay.mp4. Needs ffmpeg. There is no sound: headless Chrome is muted.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openGame } from '../kit/tools/check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Each route is the heading the starter car faces (radians, 0 = +z) and the points to
// drive through, in metres, keeping to the right-hand lane of each game's street grid.
// `time` is the game's own key for moving the clock forward, where it has one.
// `mirrored` marks a game whose A and D turn the wrong way round.
const ROUTES = {
  'fable-5.2': {
    heading: Math.PI / 2,
    points: [[-100, 181.75], [28, 181.75], [37.75, 172], [37.75, 116], [28, 106.25], [-90, 106.25]],
    time: (game) => game.hold('T', 6000),
  },
  'opus-5.5': {
    heading: 0,
    points: [[28.5, -50], [28.5, 148], [20, 156.5], [-20, 156.5], [-28.5, 148], [-28.5, 70]],
    time: async (game) => {
      for (let i = 0; i < 5; i++) {
        await game.hold('T');
        await sleep(900);
      }
    },
  },
  'inkling-2-mini': {
    heading: 0,
    mirrored: true,
    points: [[-3, -20], [-3, 45], [-10, 53], [-46, 53], [-53, 45], [-53, 10], [-46, 3], [-8, 3]],
  },
};

const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Drive through `points` by steering toward each in turn. Gives up after `limit` ms. */
async function drive(game, { heading, points, mirrored }, limit = 45000) {
  const [left, right] = mirrored ? ['D', 'A'] : ['A', 'D'];
  const held = new Set();
  const set = async (key, on) => {
    if (on === held.has(key)) return;
    on ? held.add(key) : held.delete(key);
    await (on ? game.down(key) : game.up(key));
  };
  let last = await game.state();
  let stuckSince = null;
  let next = 0;
  for (const end = Date.now() + limit; Date.now() < end && next < points.length; await sleep(50)) {
    const now = await game.state();
    if (!now || now.mode !== 'car') break;
    const moved = Math.hypot(now.x - last.x, now.z - last.z);
    if (moved > 0.4) {
      heading = Math.atan2(now.x - last.x, now.z - last.z);
      last = now;
    }
    const [x, z] = points[next];
    const distance = Math.hypot(x - now.x, z - now.z);
    if (distance < 7) {
      next++;
      continue;
    }
    const error = wrap(Math.atan2(x - now.x, z - now.z) - heading);
    const speed = Math.abs(now.speed);

    // Stuck against something: back out with the wheel turned the other way.
    if (speed < 0.5) stuckSince ??= Date.now();
    else stuckSince = null;
    if (stuckSince && Date.now() - stuckSince > 1800) {
      for (const key of [...held]) await set(key, false);
      await game.hold(error > 0 ? `S+${right}` : `S+${left}`, 1300);
      heading = wrap(heading + (error > 0 ? -0.5 : 0.5));
      last = await game.state();
      stuckSince = null;
      continue;
    }

    // Turning left makes the heading larger, turning right makes it smaller.
    await set(left, error > 0.05);
    await set(right, error < -0.05);
    const cruise = Math.abs(error) > 0.25 || distance < 22 ? 9 : 19;
    await set('W', speed < cruise);
    await set('S', speed > cruise + 5);
  }
  for (const key of [...held]) await set(key, false);
  return next;
}

async function record(name) {
  const route = ROUTES[name];
  const out = path.join(ROOT, 'results', name);
  fs.mkdirSync(out, { recursive: true });
  const game = await openGame(path.join(ROOT, 'runs', name));
  await sleep(2500);
  // The raw capture is close to lossless and huge; it is compressed once recording stops.
  const raw = path.join(os.tmpdir(), `gta7-${name}-raw.mp4`);
  const recorder = await game.page.screencast({ path: raw, format: 'mp4', fps: 30 });

  await sleep(1500);
  await game.hold('Space', 100);
  await sleep(1200);
  await game.hold('F');
  await sleep(1200);
  const reached = await drive(game, route);
  await game.hold('Space', 1500);
  for (let i = 0; i < 20 && Math.abs((await game.state())?.speed ?? 0) > 0.5; i++) await sleep(200);
  await game.hold('F');
  await sleep(1200);
  await game.hold('W+Shift', 2500);
  await game.down('W');
  await game.hold('Space', 100);
  await sleep(900);
  await game.up('W');
  await game.hold('A', 900);
  await game.hold('W', 2000);
  if (route.time) await route.time(game);
  await game.hold('D', 1200);
  await game.hold('W', 2500);
  await sleep(500);

  await recorder.stop();
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', raw,
    '-c:v', 'libx264', '-crf', '27', '-preset', 'slow', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', path.join(out, 'gameplay.mp4'),
  ]);
  fs.rmSync(raw);
  const state = await game.state();
  console.log(`${name}: reached ${reached}/${route.points.length} points, ended on ${state?.mode}, ${game.errors.length} errors`);
  await game.close();
}

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(ROUTES)) await record(name);
