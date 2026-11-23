# Lumen City - Open-World Courier

Original miniature open-world city sandbox built with Three.js r187 (core only).
Everything - geometry, textures, sky, sounds - is generated in code.

## Controls

| Key | On foot | In a vehicle |
| --- | --- | --- |
| W | move forward | accelerate |
| S | move backward | brake, then reverse |
| A / D | turn / strafe | steer |
| Shift | run | - |
| Space | jump | handbrake |
| F | get into the nearest car | get out |

No mouse required; the camera follows behind the entity automatically.
Game starts immediately on load, keyboard-only play.

## What built

- City: 4x4 block grid of roads with dashes, sidewalk slabs, lamps at intersections, a park block and a plaza block with a pond; 6 building variants (box footprints, varying heights, canvas-textured facades with lit windows at night). A deliberately empty spawn block sits next to the starter car.
- Character on foot: third-person animated humanoid (walk cycle, run, jump, idle breathing), solid capsule/box/circle collisions against buildings, sidewalks, plaza and park geometry, parked cars and world borders.
- Cars: 4 parked vehicles you can take (headlights, wheels, body roll/pitch, engine hum). Arcade driving: acceleration, braking, reverse, speed-dependent steering, handbrake, hit thuds and bounce-back, 5 m/s traffic-yielding behavior.
- Living world: 4 traffic cars on road lanes with right-hand traffic and player-yield behavior, plus 9 pedestrians strolling on sidewalk lanes with leg/shoulder swing.
- Gameplay loop: courier mission. Pick up a package at the gold beacon, then deliver it to a new target. Score +250 per delivery, deliveries counter, banner and screen-flash feedback, chime audio.
- HUD: minimap (player arrow, parked cars, traffic, pedestrians, mission beacon), speed readout in km/h while driving, score/delivery panel, controls panel, F prompt pill.
- Atmosphere: day/night cycle (~180 s) with dusk tint, sun with PCFSoft shadows, moon light, hemisphere fill, fog, sky lerp, lit windows and lamps at night, headlights at night, ACES tone mapping, WebAudio sound (engine, footsteps, chimes, thuds, blips, jump/enter/exit).
- Test hook: window.__bench with state() returning mode, x, y, z, speed (car position while driving).

## Technical notes

- Entry point index.html; ES modules under src/; Three.js r187 core only from ./vendor/three.module.js; no external assets, no build step.
- src/world.js builds the city and colliders; src/vehicle.js and src/player.js handle the two modes; src/life.js drives traffic and pedestrians; src/missions.js runs the courier loop; src/audio.js synthesizes WebAudio sound; src/hud.js draws the HUD and minimap; src/main.js wires everything together.

## Known problems

- Pedestrians and traffic do not look at or avoid the player; traffic yields by slowing, and walks into a player who keeps walking into them.
- The bench state is sampled after key release, so reported speed reads ~0 right at the end of a W hold even though the player kept moving; the position confirms real progress.
- Sound is synthesized with the Web Audio API and only starts after the first keypress (browsers block audio before interaction).
- No pause or menu - the game runs straight from load.
- Day/night phase does not wrap with a saved-time anchor, so a fresh page load always starts at the same late-morning phase.
