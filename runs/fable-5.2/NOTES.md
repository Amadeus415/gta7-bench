# Port Vesper

A small city by the sea. Walk the boardwalk, take any car, and find something to do before the sun goes down.

Open `index.html` through a static server. Everything (models, textures, sounds, music) is generated in code at load; the only dependency is the bundled Three.js core.

## Controls

| Key | On foot | In a car |
|---|---|---|
| W / S | walk forward / back | accelerate / brake, then reverse |
| A / D | turn | steer |
| Shift | run | |
| Space | jump | handbrake |
| F | get into the nearest car | get out |
| H | | horn (people ahead step aside) |
| R | | change radio station |
| E | | start a taxi shift (in a Vesper Cab) |
| T | hold to fast-forward the clock | same |
| C | camera distance | same |
| B | toggle bloom | same |
| Tab | hide the controls panel | same |

Arrow keys mirror WASD. Dragging the mouse orbits the camera and the wheel zooms; neither is needed.

## What is in it

**The city.** Twenty-odd blocks on a street grid with signalled junctions, crosswalks and parking bays, plus four places that are not grid: *Lantern Park* (two blocks merged, with a pond, a bandstand and strings of lanterns), *Meridian Plaza* (fountain, needle sculpture, café parasols), the *promenade, beach and Sundown Pier* (stalls, festoon lights, a turning Ferris wheel, a lighthouse offshore) and *Ironside Docks* (containers, a gantry crane, a freighter, stunt ramps). Buildings come in eight archetypes: glass towers with podiums and setbacks, stepped towers, brick mid-rises, L-shaped blocks, beachfront hotels with balconies, low shops, warehouses, and the Harbor Patrol station.

**On foot.** A jointed figure with knees and elbows and a procedural walk, run, jump and tumble. Solid against buildings, street furniture, cars and props; light props (cones, crates, chairs, beach balls) can be kicked.

**Cars.** Seven models built from extruded side profiles: Kestrel GT, Marlin, Pico, Bison, Caravel, Vesper Cab and Harbor Patrol. Any of them can be taken, parked or moving. Handling is a small bicycle model: speed-limited steering, tyre grip that gives way into slides, a handbrake for drifting, curb-absorbing suspension, ramps that launch the car, momentum-trading collisions.

**A living world.** About fifty AI drivers follow lanes, obey the lights, queue, give way to people, honk and unsnarl themselves; they use the same physics as the player. Sixty pedestrians walk the sidewalks, cross at corners, dodge cars and get knocked over (and get back up).

**Things to do.**
- *Courier run* (gold beam): three timed deliveries.
- *Street sprint* (blue beam, needs a car): nine gates against a par time, with medals and a saved best.
- *Taxi shift*: take a Vesper Cab and press E.
- *Heat*: knock someone over, steal an occupied car or ram a patrol car and Harbor Patrol gives chase. Break line of sight to lose them; get boxed in and you are busted and fined.
- *Tokens*: 24 around the city, four of them in mid-air off the ramps. Air time itself pays too.
- Drive off the pier ramp if you like. You get fished out.

**HUD.** Rotating minimap with job, token and police blips, speedometer with gear and rev bar, cash, heat stars, objective with distance, bearing and timer, context prompts, and the control list for the current mode.

**Atmosphere.** A full day and night cycle (the game opens in late afternoon; sunset is about a minute and a half in), sun and moon shadows, a shader sky with drifting clouds and stars, an animated sea, lit windows and neon signs after dark, street lamps, headlights, HDR bloom, particles (tyre smoke, dust, sparks, hydrant geysers), skid marks, and synthesised audio: engine, tyres, crashes, footsteps, sirens, ambience and three generative radio stations.

## Code map

`src/main.js` is the frame loop and camera. `world.js` holds the layout, road graph, ground heights and colliders; `city.js` and `scenery.js` build the static meshes; `vehicles.js` is car models and physics; `traffic.js` is AI drivers and police; `people.js` and `player.js` are the figures; `game.js` is jobs, heat and tokens; `hud.js`, `audio.js`, `sky.js`, `fx.js`, `props.js`, `post.js` and `textures.js` are what their names say.

## Known problems

- The world is flat apart from curbs and ramps, and cars cannot roll over.
- Collisions are 2D circles and boxes with a height check, so a car that lands on a container is pushed off it rather than resting on top.
- AI drivers are simple: under heavy traffic they can still knot up at a junction for a few seconds before nosing through, and police make clumsy U-turns.
- Pedestrians follow fixed routes and do not avoid each other or street furniture.
- Police never leave their cars; an arrest is just being boxed in while slow.
- There is no health or car damage model.
- Sound starts on the first key press or click in a normal browser, because of autoplay rules.
