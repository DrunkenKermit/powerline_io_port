# powerline.io — local port

An offline port of [powerline.io](https://powerline.io): the same menu, HUD,
sprites, sounds and snake rules, with bots instead of a server.

**port by kermit.dev**

## Play

Open `powerline-play.html` in a browser — it is one self-contained file, images
and sounds included, and needs no network. To serve it:

```sh
bun run dev        # http://localhost:3000
```

Because the file has no external requests it also works from a static host. If
you push the repo to GitHub, jsDelivr will serve it straight from the branch:

```
https://cdn.jsdelivr.net/gh/<user>/<repo>@main/powerline-play.html
```

## Controls

| Input | Action |
| --- | --- |
| Mouse | steer (the line follows the cursor's lane) |
| ↑ ↓ ← → / WASD | steer, with **Controls → Keys** |
| Touch drag | steer, on a touch device |
| Enter | play / play again |
| Esc | back to the menu |
| G | graphics quality |
| M | sound |
| I | FPS counter |
| L | leaderboard size |

Settings (screen shake, kill streaks, names, graphics, sound, leaderboard, stats,
control scheme and keybinds) live behind the gear in the menu and persist in
`localStorage`.

## Layout

```
src/index.html          page shell: port-only styles, the boot screen
src/main.ts             menu wiring, input, settings, run loop
src/engine.ts           simulation: snakes, bots, food, collisions, score
src/render.ts           canvas rendering: board, snakes, pellets, HUD, minimap
src/audio.ts            synthesized crash, spark and rub hum
build/menu              the menu markup, styles it carries inline, About page
build/assets            stylesheet, sprites, wordmark, font and music
build.ts                inlines src/ and build/ into powerline-play.html
serve.ts                serves that file
tools/bots.ts           headless bot soak (deaths, lifetimes, head teleports)
```

The output is a single file with no external requests, so `build/` holds only
what the build reads.

## Build

```sh
bun run build      # writes powerline-play.html
bun run typecheck
```

## Credits

The game, its art, fonts, sounds and menu are powerline.io's. This is an
unofficial fan port, unaffiliated with the original.

port by kermit.dev
