# SQUAREHEAD in "The Hard Game"

An Undertale-style survival fight against Cuphead-style bosses. You play as a square.

**To play, open `index.html` in a browser.** You don't need to install or build anything.

## Story

The Square Sea had four rulers: **King Cubert** of Block Isle, **Queen Vortex** of Spiral Isle,
**King Sawbones** of the Rust Reef and **King Tick-Tock** of Clockwork Cay. Then **the Null**, a
virus that copies itself into everything it touches, woke up on the Core island in the middle of
the sea and infected all four of them. Only a tiny square was too simple for it to copy.

- The first time you press **PLAY**, a short story video plays (you can replay it from **STORY** on
  the title screen). After that, the **TUTORIAL** with the Old Sage teaches you to move, dash
  through lasers, dodge and jump as a blue square.
- On the **map** you sail between the islands. Each island unlocks after you free the one before
  it, and the Core opens last.
- Each fight takes place in front of that ruler's island, a little darker. The Null fights in a
  black void.
- Between phases the fight pauses and the ruler talks to you.
- When you outlast a ruler, a short clip shows the virus being pulled out of them, and then the
  freed ruler thanks you and points you to the next island. Beating the Null shows it breaking
  apart into pixels, followed by an ending video.


- **You can't attack, you can only dodge.** The boss dies on its own when its timer bar runs out,
  so you have to stay alive until then (from about 1½ minutes for the first boss on STORY up to over 4
  minutes for the last boss on IMPOSSIBLE).
- **The whole screen is the arena.** The boss starts in the middle. It moves to a new spot for
  every attack and drifts around while it attacks. It also charges between corners and leaps onto
  where you're standing. Touching it hurts.
- **The attacks follow fixed patterns.** Each boss has a set order of attacks for each of its
  3 phases, and every attack lays out its bullets the same way each time, so you can learn them.
  Each phase is made of whole attacks, so the last attack of a phase ends exactly when the timer
  bar reaches that phase's mark.
- **The boss changes your square.** Before some attacks the boss glows, fires a bolt at you and
  turns you into a different kind of square. Each boss has its own set of squares:

| Square | Effect |
| --- | --- |
| Red | normal |
| Blue (↓ ↑ ← →) | gravity pulls one way, and you jump |
| Purple | controls reversed |
| Cyan | slippery like ice |
| Yellow / Orange | hyper fast / heavy and slow |
| Clock / Turbo | time slows down / speeds up |
| Giant | you're much bigger |
| Shadow | lights out |

## Controls (you can change them in SETTINGS)

| Action | Default keys |
| --- | --- |
| Move | Arrows / WASD |
| Dash (you're invincible while dashing) | Left Shift / C |
| Jump (only as a blue square) | Space / Z |
| Pause | Esc / P |

Menus always use the arrow keys, Enter and Esc. M mutes the sound.

## Difficulty and medals

On the map, use ↑ ↓ to pick a row and ← → to change it (on the first row, ← → sails between islands):

- **MODE** sets how strong the bosses are. On harder modes the attacks are faster, have more
  bullets and bigger bullets, the warnings are shorter, the boss moves around more, and you have
  to survive longer.

| Mode | Attack speed | Bullets | Bullet size | Fight length |
| --- | --- | --- | --- | --- |
| STORY | ×0.85 | ×0.8 | ×1.0 | ×1.0 |
| NORMAL | ×1.0 | ×1.0 | ×1.15 | ×1.15 |
| HARD | ×1.12 | ×1.25 | ×1.3 | ×1.3 |
| EXPERT | ×1.25 | ×1.5 | ×1.4 | ×1.5 |
| INSANE | ×1.4 | ×1.8 | ×1.5 | ×1.75 |
| IMPOSSIBLE | ×1.55 | ×2.1 | ×1.6 | ×2.0 |

- **HITS** sets how many hits you can take, from **1 (one hit = death)** up to **15**.

When you win, you get a medal based on how many times you were hit:

**DIAMOND** no hits · **GOLD** 1–2 · **SILVER** 3–5 · **BRONZE** 6 or more

Your best medal for each boss, and the mode you won it on, is saved in the browser. To start over, go to **SETTINGS → RESET PROGRESS**. It asks you to confirm, then locks every
boss except the first and erases your medals. Your keys and your MODE and HITS settings stay.

## Sound

Each boss has its own music, and the menus have a separate theme. Every attack, every square
change and every important event has its own sound effect.

## Islands and bosses

1. **King Cubert of Block Isle**: red, blue and purple squares. Bullet rain, bone walls, slams
2. **Queen Vortex of Spiral Isle**: red, cyan, purple and upward-blue squares. Spirals, homing missiles, closing rings
3. **King Sawbones of the Rust Reef**: blue squares in every direction, plus yellow and orange. Saws, sniper lasers, charges
4. **King Tick-Tock of Clockwork Cay**: clock, turbo, red and blue squares. Clock-hand lasers, laser grids
5. **The Null, on the Core**: almost every square, including giant and shadow, with some attacks running at the same time

Free a ruler to unlock the next island. Press **U** on the map to unlock all of them for practice.
