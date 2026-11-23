#!/usr/bin/env node
// Builds results/index.html from each entry's auto.json (play-test), judge.json (feature
// review) and run.json (how the run went).
//
//   node harness/report.mjs            images linked, for viewing through a local server
//   node harness/report.mjs --inline   images embedded, so the one file stands alone
//
// Each entry's gameplay.mp4 (from harness/record.mjs) is shown in the linked page only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = path.join(ROOT, 'results');
const inline = process.argv.includes('--inline');

const AREAS = [
  ['city', 'City'],
  ['character', 'On foot'],
  ['vehicles', 'Vehicles'],
  ['world', 'Living world'],
  ['hud', 'HUD'],
  ['gameplay', 'Something to do'],
  ['atmosphere', 'Atmosphere'],
];
const SHOTS = [
  ['1-start.jpg', 'On load'],
  ['2-driving.jpg', 'Driving'],
  ['3-on-foot.jpg', 'On foot'],
  ['4-later.jpg', '30 seconds later'],
];

const escape = (text) =>
  String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const read = (name, file) => {
  const full = path.join(RESULTS, name, file);
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8')) : null;
};
const image = (name, file) => {
  const full = path.join(RESULTS, name, file);
  if (!fs.existsSync(full)) return null;
  return inline
    ? 'data:image/jpeg;base64,' + fs.readFileSync(full).toString('base64')
    : `${name}/${file}`;
};

const entries = fs
  .readdirSync(RESULTS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const name = entry.name;
    const auto = read(name, 'auto.json');
    const judge = read(name, 'judge.json') ?? { areas: {} };
    const run = read(name, 'run.json') ?? {};
    const playtest = (auto?.passed ?? 0) * 3;
    const features = AREAS.reduce((sum, [id]) => sum + (judge.areas[id]?.score ?? 0), 0);
    return { name, auto, judge, run, playtest, features, total: playtest + features };
  })
  .sort((a, b) => b.total - a.total);

const summaryRows = entries
  .map(
    (e, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td><a href="#${e.name}"><strong>${escape(e.run.label ?? e.name)}</strong></a>
          <div class="muted">${escape(e.judge.title ?? '')}</div></td>
        <td class="num total">${e.total}</td>
        <td class="bar-cell"><div class="bar" role="img" aria-label="${e.playtest} play-test points and ${e.features} feature points out of 100">
          <span class="seg play" style="width:${e.playtest}%"></span><span class="seg feat" style="width:${e.features}%"></span></div></td>
        <td class="num">${e.playtest}<span class="muted">/30</span></td>
        <td class="num">${e.features}<span class="muted">/70</span></td>
        <td class="num">${escape(e.run.minutes ?? '?')}<span class="muted"> min</span></td>
        <td class="num">${(e.auto?.code.lines ?? 0).toLocaleString('en-US')}</td>
      </tr>`,
  )
  .join('');

const cards = entries
  .map((e) => {
    const shots = SHOTS.map(([file, caption]) => {
      const src = image(e.name, file);
      return src
        ? `<figure><img src="${src}" alt="${escape(e.run.label ?? e.name)}: ${caption}" loading="lazy"><figcaption>${caption}</figcaption></figure>`
        : '';
    }).join('');
    const checks = (e.auto?.checks ?? [])
      .map(
        (c) =>
          `<li class="${c.pass ? 'pass' : 'fail'}"><span class="mark">${c.pass ? 'pass' : 'fail'}</span> ${escape(c.label)}${c.detail ? ` <span class="muted">${escape(c.detail)}</span>` : ''}</li>`,
      )
      .join('');
    // The videos are too big to embed, so the standalone page leaves them out.
    const hasVideo = !inline && fs.existsSync(path.join(RESULTS, e.name, 'gameplay.mp4'));
    const video = hasVideo
      ? `<video controls muted preload="metadata" poster="${e.name}/1-start.jpg" src="${e.name}/gameplay.mp4"></video>`
      : '';
    const areas = AREAS.map(([id, label]) => {
      const area = e.judge.areas[id] ?? {};
      return `<tr><th scope="row">${label}</th><td class="num">${area.score ?? '-'}<span class="muted">/10</span></td><td>${escape(area.note ?? '')}</td></tr>`;
    }).join('');
    return `
    <section class="card" id="${e.name}">
      <header>
        <div>
          <h2>${escape(e.run.label ?? e.name)}</h2>
          <p class="muted">${escape(e.judge.title ? `"${e.judge.title}"` : '')} ${escape(e.run.harness ?? '')}</p>
        </div>
        <div class="score">${e.total}<span class="muted">/100</span></div>
      </header>
      <p>${escape(e.judge.verdict ?? '')}</p>
      ${video}
      <div class="shots">${shots}</div>
      <div class="cols">
        <div>
          <h3>Play-test <span class="muted">${e.auto?.passed ?? 0} of ${e.auto?.total ?? 10}</span></h3>
          <ul class="checks">${checks}</ul>
        </div>
        <div>
          <h3>Features <span class="muted">${e.features} of 70</span></h3>
          <table class="areas">${areas}</table>
        </div>
      </div>
      <p class="muted">${escape(e.run.notes ?? '')}</p>
      <p><a href="../runs/${e.name}/index.html">Play it</a> <span class="muted">(needs a local server, see below)</span></p>
    </section>`;
  })
  .join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GTA7 Bench</title>
<style>
  :root {
    --bg: #f6f4ef; --surface: #ffffff; --ink: #1c1b19; --muted: #6b675f; --line: #e2ded5;
    --play: #2f6fb3; --feat: #e08a2e; --pass: #1f7a4d; --fail: #b3362c;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #15161a; --surface: #1e2026; --ink: #ece9e2; --muted: #9a968c; --line: #2f323a;
      --play: #6aa5e6; --feat: #f0a552; --pass: #5cc48f; --fail: #f0796d;
    }
  }
  :root[data-theme="dark"] {
    --bg: #15161a; --surface: #1e2026; --ink: #ece9e2; --muted: #9a968c; --line: #2f323a;
    --play: #6aa5e6; --feat: #f0a552; --pass: #5cc48f; --fail: #f0796d;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 40px 16px 80px; }
  h1 { font-size: 2.4rem; line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.02em; }
  h2 { font-size: 1.4rem; margin: 0; }
  h3 { font-size: 1rem; margin: 24px 0 8px; }
  a { color: inherit; }
  .lede { max-width: 68ch; color: var(--muted); margin: 0 0 32px; }
  .muted { color: var(--muted); font-weight: 400; font-size: 0.9em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  .summary th { text-align: left; font-size: 0.8rem; color: var(--muted); font-weight: 500;
    padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .summary th.num { text-align: right; }
  .summary td { padding: 14px 12px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .summary .rank { color: var(--muted); width: 2ch; }
  .summary .total { font-size: 1.5rem; font-weight: 700; }
  .bar-cell { width: 34%; min-width: 160px; }
  .bar { display: flex; gap: 2px; height: 14px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .seg.play { background: var(--play); } .seg.feat { background: var(--feat); }
  .legend { display: flex; gap: 20px; font-size: 0.85rem; color: var(--muted); margin: 12px 0 40px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
    padding: 24px; margin: 0 0 24px; }
  .card header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .card header p { margin: 4px 0 0; }
  .score { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .shots { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 16px 0 0; }
  video { width: 100%; aspect-ratio: 16 / 9; display: block; margin: 16px 0 0;
    border-radius: 8px; border: 1px solid var(--line); background: #000; }
  figure { margin: 0; }
  figure img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block;
    border-radius: 6px; border: 1px solid var(--line); background: #000; }
  figcaption { font-size: 0.8rem; color: var(--muted); margin-top: 4px; }
  .cols { display: grid; grid-template-columns: 1fr 1.4fr; gap: 32px; }
  .checks { list-style: none; margin: 0; padding: 0; font-size: 0.92rem; }
  .checks li { padding: 3px 0; }
  .mark { display: inline-block; min-width: 3.2ch; font-weight: 600; font-size: 0.8rem; }
  .pass .mark { color: var(--pass); } .fail .mark { color: var(--fail); }
  .areas th { text-align: left; font-weight: 500; white-space: nowrap; padding: 4px 12px 4px 0; vertical-align: top; }
  .areas td { padding: 4px 12px 4px 0; vertical-align: top; font-size: 0.92rem; }
  .method { max-width: 72ch; }
  .method li { margin-bottom: 6px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  @media (max-width: 760px) {
    .shots { grid-template-columns: repeat(2, 1fr); }
    .cols { grid-template-columns: 1fr; gap: 0; }
    h1 { font-size: 1.9rem; }
  }
</style>
</head>
<body>
<main>
  <h1>GTA7 Bench</h1>
  <p class="lede">Three models were each given one unattended session to build an original
  miniature open-world city game in the browser: walk around, get into any car, drive off.
  Same brief, same starting folder, same agent harness (Claude Code). Each game was then
  play-tested by a script and reviewed by a judge.</p>

  <div class="scroll">
  <table class="summary">
    <thead><tr>
      <th></th><th>Model</th><th class="num">Score</th><th></th>
      <th class="num">Play-test</th><th class="num">Features</th>
      <th class="num">Build time</th><th class="num">Lines of code</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  </div>
  <div class="legend"><span><i style="background:var(--play)"></i>Play-test (30)</span><span><i style="background:var(--feat)"></i>Features (70)</span></div>

  ${cards}

  <section class="method">
    <h2>How this was scored</h2>
    <ul>
      <li><strong>Play-test, 30 points.</strong> Ten scripted checks in headless Chrome, 3 points
      each, identical for every entry (<code>harness/score.mjs</code>). The steering check only
      asks that D changes the car's direction, so it passed Inkling's mirrored steering; that
      shows up in its feature scores instead.</li>
      <li><strong>Features, 70 points.</strong> Seven areas from the brief, 10 points each, scored
      by Claude Fable 5.2 after playing each game through the test tool and reading its code.
      The judge knew which model built which game, and is itself one of the contestants' models.</li>
      <li><strong>One run per model.</strong> A single attempt each, so small differences are noise.</li>
      <li><strong>Not a level field.</strong> Inkling 2 Mini ran on a laptop with 4-bit weights, a
      100,000-token context and a shell limited to the test tool. The Claude models ran in the
      cloud with full shell access.</li>
      <li><strong>To play:</strong> from the project folder run <code>python3 -m http.server 8000</code>
      and open <code>http://localhost:8000/results/</code>.</li>
    </ul>
  </section>
</main>
</body>
</html>
`;

const out = path.join(RESULTS, inline ? 'report-standalone.html' : 'index.html');
fs.writeFileSync(out, html);
console.log('wrote', out);
