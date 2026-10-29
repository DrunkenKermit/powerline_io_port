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
game/index.html     page shell: port-only styles, the boot screen
game/main.ts        menu wiring, input, settings, run loop
game/engine.ts      simulation: snakes, bots, food, collisions, score
game/render.ts      canvas rendering: board, snakes, pellets, HUD, minimap
game/audio.ts       synthesized crash, spark and rub hum
rip/ui              the original menu markup, About page and sprite rects
rip/site            the original stylesheet, sprites, font and sound
build-game.ts       inlines everything into powerline-play.html
serve.ts            serves that file
tools/bots.ts       headless bot soak (deaths, lifetimes, head teleports)
```

## Build

```sh
bun run build      # writes powerline-play.html
bun run typecheck
```

## Credits

The game, its art, fonts, sounds and menu are powerline.io's. This is an
unofficial fan port, unaffiliated with the original.

port by kermit.dev
