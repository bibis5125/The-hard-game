# SQUAREHEAD in "The Hard Game"

An Undertale-style survival fight against Cuphead-style bosses. You play as a square.

**To play, open `index.html` in a browser.** You don't need to install or build anything.

## How it works

- **You can't attack, you can only dodge.** The boss dies on its own when its timer bar runs out,
  so you have to stay alive until then (from 75 seconds for the first boss on STORY up to 4 minutes for
  the last boss on IMPOSSIBLE).
- **The whole screen is the arena.** The boss starts in the middle. It moves to a new spot for
  every attack and drifts around while it attacks. It also charges between corners and leaps onto
  where you're standing. Touching it hurts.
- **The attacks follow fixed patterns.** Each boss has a set order of attacks for each of its
  3 phases, and every attack lays out its bullets the same way each time, so you can learn them.
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

On the boss-select screen, use ↑ ↓ to pick a row and ← → to change it:

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

## Bosses

1. **Cubert, the Block King**: red, blue and purple squares. Bullet rain, bone walls, slams
2. **Madame Vortex, the Spiral Witch**: red, cyan, purple and upward-blue squares. Spirals, homing missiles, closing rings
3. **Sawbones, the Grinning Grinder**: blue squares in every direction, plus yellow and orange. Saws, sniper lasers, charges
4. **Tick-Tock Tyrant, Keeper of Lost Seconds**: clock, turbo, red and blue squares. Clock-hand lasers, laser grids
5. **The Null**: almost every square, including giant and shadow, with some attacks running at the same time

Beat a boss to unlock the next one. Press **U** on the boss-select screen to unlock all of them for practice.
