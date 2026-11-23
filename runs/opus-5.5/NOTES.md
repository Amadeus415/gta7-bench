# Halcyon Bay

A small open-world harbour town in the browser. Walk the sidewalks, take any car (parked or
carjacked), run courier jobs against the clock, and shake off the police when things go wrong.
Everything (city, cars, people, textures, sound) is generated in code on top of Three.js r187.

## Controls

| Key | On foot | Driving |
|---|---|---|
| W / S | walk forward / back | accelerate / brake, then reverse |
| A / D | turn | steer |
| Shift | run | |
| Space | jump | handbrake (drift) |
| F | get into the nearest car (pulls out an AI driver) | get out |
| Q | | horn (scares pedestrians) |
| C | | toggle near / far chase camera |
| Mouse drag / wheel | look / zoom | orbit / zoom |
| T | skip ahead two hours | |
| M / H | mute / hide the controls panel | |

## What's in it

- **City**: a 6×6 grid of avenues and streets (all named) with lane markings, zebra crossings,
  raised sidewalks and kerbs, ~60 buildings in three facade styles with setbacks and rooftop
  clutter, a downtown cluster of towers, dockside warehouses with container stacks, Greenway
  Park (pond, gazebo, obelisk, paths), Fountain Plaza (animated fountain, cafés), and a harbour
  promenade with palms, a boardwalk, a pier with a working lighthouse, and boats on the water.
- **On foot**: a jointed character with walk, run, jump and fall animations; solid collisions,
  step-up onto low things (benches, fountain rim, car roofs).
- **Cars**: seven invented models (compact, sedan, sports, van, pickup, cab, police). Arcade
  physics with throttle falloff, braking then reversing, speed-sensitive steering, grip-limited
  yaw, a handbrake that breaks traction, body pitch and roll, wheel spin and steering, brake
  lights, collisions with the world and between cars, skid marks.
- **Living world**: ~24 AI drivers plus police patrols following the lane graph, turning at
  junctions, stopping at working traffic lights (every junction cycles on its own offset),
  braking for cars and people, honking and backing out when stuck; street lamps snap and topple
  when you hit them; ~44 pedestrians walking the block
  perimeters, crossing at the zebras, fleeing speeding cars and horns, and getting knocked down.
- **HUD**: rotating minimap with roads, buildings, cars, cops and the objective; speedometer
  (km/h and m/s, gear); clock, cash, wanted stars; street/district name; context prompts;
  controls panel that changes between on-foot and driving.
- **Gameplay**:
  - *Courier jobs*: drive into the yellow beacon to pick up cargo, then reach the green beacon
    before the timer runs out. Pay scales with distance, time left and a delivery streak;
    fragile cargo (wedding cake, glass floats…) loses value every time you crash.
  - *Harbor Sprint*: drive into the cyan beacon on Harbor Rd to start a 12-checkpoint race
    around the city (glowing rings, lap timer, par time, best-time record, cash prize).
  - *Wanted level*: hitting pedestrians, ramming cops, carjacking in sight of police or stealing
    a cruiser adds stars. Police cars route across the grid and then pursue directly. Stay
    more than ~75 m from every cruiser to let stars fade; stop next to one and you're busted
    (fined).
- **Atmosphere**: a 7-minute day/night cycle with a shader sky (sun, moon, stars), moving
  shadows, fog, lit windows, street-lamp light pools and real lights near the camera,
  headlights and ground beams, lighthouse beam sweeping at night, rippling sea. Synthesised
  audio: engine with gear changes, tyre squeal, crashes, horn, siren, footsteps, waves.

## Code

`index.html` loads `src/main.js`. `world.js` builds the city and collision grid,
`car.js` the vehicles and physics, `traffic.js` AI drivers, police routing and pedestrians,
`player.js` / `character.js` the person, `game.js` jobs and wanted level, `sky.js`,
`hud.js`, `audio.js`, `textures.js`.

## Known problems

- Cars are 2D physics (no flipping, no ramps). Car collision shapes are chains of circles, so a
  car's corner can sink slightly into a wall.
- AI drivers ignore each other at junctions beyond simple braking, so the odd fender-bender
  happens; they recover by backing out.
- Pedestrians don't avoid each other and walk through one another.
- Sound starts on the first key press (browser autoplay rules).
