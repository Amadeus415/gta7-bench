# GTA7 Bench: build a miniature open-world city game

Several AI models are given this identical task, in an identical starting directory. The
results are play-tested and compared. You get one session and no follow-up, so make your
own decisions rather than asking questions.

## The game

Build a small, original, open-world city sandbox in 3D that runs in a browser: the kind of
game where you walk around a city, get into any car you like, and drive off. The world can
be small, a few city blocks is plenty, but it must be a real, navigable 3D place, and it
should be fun for five minutes.

What a strong entry has:

1. **A city.** Roads you can follow, sidewalks, buildings of different shapes and heights,
   and at least one area that is not just a street grid (a park, a waterfront, a plaza).
2. **A character on foot.** Third-person, animated enough to read as a person, with walking,
   running and jumping, and solid collisions with the world.
3. **Cars you can take.** Several vehicles in the world. Get in, drive, get out. Driving
   should feel like driving: acceleration, braking, steering that depends on speed, and
   collisions.
4. **A living world.** Other cars driving along the roads and pedestrians walking the
   sidewalks.
5. **A HUD.** At minimum a minimap and a speed readout while driving, with the controls
   shown on screen.
6. **Something to do.** At least one gameplay loop: a mission with a goal and a reward, a
   wanted level with police that chase you, checkpoint races, or something of your own.
7. **Atmosphere.** Lighting, shadows, a day and night cycle, sound, anything that makes
   the place feel alive.

Make it your own. Give the game its own title and its own world. Do not use the names,
characters, places, logos or other content of existing games or real brands.

## Technical rules

- The entry point is `index.html` in this directory. It will be served by a local static
  HTTP server, so ES modules work. Split the code into more files if you like.
- Three.js r187 (core only) is provided: `import * as THREE from './vendor/three.module.js'`.
  No other libraries, no Three.js addons, no build step, no network requests. Every model,
  texture and sound must be made in code.
- It must run smoothly in desktop Chrome at 1280x720.
- The game starts as soon as the page loads. No menu, no click-to-start, and no pointer
  lock requirement: the keyboard alone must be enough to play. Mouse control is a welcome
  extra.
- World units are meters, with Y up.
- The player starts on foot, standing next to a parked car, close enough that pressing F
  gets in straight away, with clear road ahead of that car.

### Controls (fixed, so every entry can be tested the same way)

| Key | On foot | In a vehicle |
|---|---|---|
| W | move forward | accelerate |
| S | move backward | brake, then reverse |
| A / D | turn or strafe | steer |
| Shift | run | |
| Space | jump | handbrake |
| F | get into the nearest vehicle | get out |

Other keys are yours to use.

### Test hook (required)

Within three seconds of loading, the page must define:

```js
window.__bench = {
  state() {
    return { mode, x, y, z, speed };
  },
};
```

- `mode` is `"foot"` or `"car"`.
- `x`, `y`, `z` are the player's world position in meters (the car's position while driving).
- `speed` is the player's current speed in meters per second.

## Testing your work

`tools/check.mjs` loads your game in headless Chrome the same way the scorer does:

```sh
node tools/check.mjs                               # load, wait, report errors, save screenshot.png
node tools/check.mjs --play "F W:3000 F W:2000"    # then press keys in order; KEY or KEY:holdMilliseconds
```

It prints console errors, the frame rate and the test hook's state after each key, and it
saves `screenshot.png`, which you can open to see what your game looks like.

## What to hand in

- `index.html` and whatever code it needs.
- `NOTES.md`, short: the game's title, the controls, what you built, and known problems.

Work only inside this directory, and do the work yourself (no sub-agents). Only what is in
this directory when your session ends is scored, so get a playable `index.html` in place
early and keep it working as you add to it.

## Scoring

1. **Automated play-test (10 checks).** Loads without errors; draws a scene; test hook
   works; F gets into the car; W drives it; A/D steer it; F gets out; W walks; at least
   30 frames per second; no errors over a longer session.
2. **Feature review (7 areas, the list above).** A judge plays the game and reads the code,
   scoring each area on whether it is there, whether it works, and how good it feels.
