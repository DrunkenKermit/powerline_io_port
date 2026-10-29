// Canvas renderer. Snakes are glowing polylines with a bright head, pellets are
// soft orbs, and the whole in-game HUD (score, leaderboard, minimap) is painted
// here rather than laid out in the document, as the original does.

import { CONFIG, interpolatedHead, interpolatedPath, type Pellet, type Snake, type Vec, type World } from "./engine.ts";

export interface Art {
  food: HTMLImageElement | null;
  boostHint: HTMLImageElement | null;
  /** Board tile, cropped out of the sprite sheet. */
  board: HTMLImageElement | HTMLCanvasElement | null;
  /** The sprite sheet itself; the sprites below are cut from it. */
  sheet: HTMLImageElement | null;
}

/**
 * Sprite rectangles in the sheet, as the original's `Global.resources.frames`
 * lays them out: head dot, two haloes, pellet, crown, and the skull pieces the
 * kill-streak icon is composed from.
 */
const FRAMES = {
  head: [132, 104, 47, 46],
  food: [132, 2, 100, 100],
  glow: [234, 2, 98, 98],
  glowHard: [334, 2, 98, 98],
  crown: [382, 102, 31, 27],
  skullBack: [300, 133, 28, 17],
  skullBase: [226, 104, 35, 40],
  skullGlow: [434, 2, 58, 64],
  skullGradient: [263, 102, 35, 40],
  eyeRed: [382, 131, 24, 11],
  eyeYellow: [44, 132, 24, 11],
  eyeGreen: [477, 131, 24, 11],
  eyeBlue: [2, 135, 24, 11],
  wallStretch: [2, 132, 40, 1],
  /** The particle dot, `particleDot` on the sheet. */
  particle: [461, 131, 14, 19],
  /** The three rub-spark frames, `spark0`–`spark2`. */
  spark0: [434, 68, 49, 29],
  spark1: [300, 102, 41, 29],
  spark2: [343, 102, 37, 30],
  /** The three bolt frames the client cycles between two rubbing snakes. */
  lightning1: [415, 102, 18, 30],
  lightning2: [461, 99, 20, 30],
  lightning3: [483, 99, 19, 30],
  /** The additive halo the client lays under the bolt. */
  lightningGlow: [435, 99, 24, 36],
} as const satisfies Record<string, readonly [number, number, number, number]>;

type FrameName = keyof typeof FRAMES;

/**
 * The client's own in-game proportions, as world units at the view this port
 * draws. They come from the client's draw code, not from taste:
 *
 * - a snake's body is `getWidth()` = **2.78** of its world units wide, and its
 *   world is ~6.8× taller on screen than this port's, so on this camera that is
 *   a hair over a third of a world unit — a thin glowing line, not a tube;
 * - the head is the 47×46 `head_dot` frame drawn at `0.21 × width/2.5`, and the
 *   pellet is the 100×100 `food` frame at `0.2`, which is why in the original the
 *   pellets read bigger than the snake's body;
 * - names are `Bold 10px` at 30 snake-units above the head, i.e. a small label
 *   just clear of it;
 * - the kill-streak skull is a 64px icon, and the crown 19.2px wide.
 */
const BODY_WIDTH = 0.42;
const HEAD_SIZE = 1.9;
const HEAD_GLOW = 3.4;
const FOOD_SIZE = 3.0;
const NAME_FONT = 1.45;
const NAME_OFFSET = 4.2;
const STREAK_SIZE = 5.2;
const CROWN_SIZE = 2.1;

/** Sprites tinted per hue, so a pellet or head never re-tints per frame. */
const tintCache = new Map<string, HTMLCanvasElement>();

function frame(art: Art, name: FrameName, color: string | null = null): HTMLCanvasElement | null {
  if (!art.sheet) return null;
  const key = `${name}|${color ?? "plain"}`;
  const cached = tintCache.get(key);
  if (cached) return cached;
  const [x, y, w, h] = FRAMES[name];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d")!;
  c.drawImage(art.sheet, x, y, w, h, 0, 0, w, h);
  if (color) {
    c.globalCompositeOperation = "source-in";
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
  }
  tintCache.set(key, canvas);
  return canvas;
}

/** Draws a sprite centred on a world point. */
function sprite(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height = width,
) {
  ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  /** Pixels per world unit at the current zoom. */
  scale: number;
}

export type LeaderboardSize = "off" | "small" | "big";

export interface RenderOptions {
  quality: "high" | "low";
  /** The menu draws the arena the client shows behind its join screen, with no
   * score, leaderboard or minimap of its own: before a player joins there is no
   * player to report on. */
  hud?: boolean;
  /** Seconds this run has been alive; the client shows it bottom-left. */
  timeAlive: number;
  names: boolean;
  killStreaks: boolean;
  leaderboard: LeaderboardSize;
  /** Screen shake intensity, 0 to 1. */
  shake: number;
  cursor: { x: number; y: number } | null;
  /** Milliseconds, used for the boost trail flicker. */
  now: number;
  showBoostHint: boolean;
}

/** The view is this many world units tall at DefaultZoom. */
const VIEW_UNITS = 95;
/**
 * The client's own HUD face. Its stylesheet aliases `proxima-nova-1/2` to the
 * same Roboto Black file as `Powerline Display`, so the two names are the same
 * face; the order just keeps whichever the page has loaded.
 */
const HUD_FONT = '"Powerline Display", "proxima-nova-1", "proxima-nova-2", "Arial Black", Arial, sans-serif';
/**
 * The client's HUD ink, read off its own text textures at runtime: every HUD
 * label is `#09ffff` — a hair bluer than the menu's `#05ffff` — and carries a
 * soft dark-cyan drop shadow rather than a glow.
 */
const HUD_INK = "#09ffff";
const HUD_SHADOW = "rgba(0, 150, 150, 0.85)";
/** The client's HUD type: bold 15px for the corner readouts. */
const HUD_SIZE = 15;
const HUD_LINE = 20;

/**
 * The board the client stands the game on. It is not a flat colour and not a line
 * grid: it is the first tile of its own playfield sprite, `images/sheet.png` (the
 * 128×128 piece at 2,2 — a 4×4 weave of #001923, #001b27 and #001f2a cells),
 * repeated across the whole viewport.
 *
 * Measured off the client's own renderer at four viewport sizes: one tile covers
 * exactly 0.12 × viewport height (96px at 800, 84px at 700), with a fixed phase.
 */
const BOARD_TILE_PX = 128;
const BOARD_TILE_SCALE = 0.12;

/**
 * How much of the display's native resolution to use on the high setting, 0–1.
 *
 * The client renders its canvas at the display's pixel ratio, which is what
 * keeps its lines crisp on a retina screen; the port drew at CSS pixels and let
 * the browser upscale, so it was soft on exactly those displays. Rendering at 2x
 * costs four times the fill, though, and on a machine that cannot hold 60fps the
 * cure is worse than the disease — choppy instead of soft. So the scale is
 * adaptive: full native resolution while frames are comfortably inside the 60fps
 * budget, stepping back toward CSS pixels when they are not, and recovering when
 * they are again. The client does the same kind of budgeting (`mobileRenderScale`,
 * `defaultRetinaValue`); this is the same idea driven by the real frame clock.
 */
let resolutionScale = 1;
let frameAverage = 16.7;
let slowRun = 0;
let fastRun = 0;

/** Feeds one frame's duration into the adaptive render scale. */
export function noteFrameTime(dtMs: number) {
  // The decision is made on an average, not on the last frame: a machine that
  // manages 60fps on only part of its frames alternates 16.7 and 33.4, and a
  // consecutive-frames rule would never see that as slow.
  frameAverage = frameAverage * 0.9 + Math.min(dtMs, 100) * 0.1;
  if (frameAverage > 20.5) {
    slowRun += 1;
    fastRun = 0;
  } else if (frameAverage < 15.5) {
    fastRun += 1;
    slowRun = 0;
  } else {
    slowRun = 0;
    fastRun = 0;
  }
  if (slowRun >= 20 && resolutionScale > 0.01) {
    // A frame this far over budget means the display cannot afford this many
    // pixels at all, not that it is marginal: drop straight past the middle.
    // `0` is the floor — CSS pixels, which is the cheapest the client ever draws.
    resolutionScale = Math.max(0, resolutionScale - (frameAverage > 30 ? 0.3 : 0.12));
    slowRun = 0;
  } else if (fastRun >= 900 && resolutionScale < 1) {
    // Recovery is deliberately rare and small (a tenth of the way back to native
    // after fifteen seconds of solid frames): stepping up and back down every
    // few seconds would trade a soft image for one that stutters in bursts.
    resolutionScale = Math.min(1, resolutionScale + 0.1);
    fastRun = 0;
  }
}

/** The backing-store density for a frame: native resolution, scaled adaptively. */
function densityFor(quality: "high" | "low") {
  if (quality === "low") return 0.5;
  const native = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  return 1 + (native - 1) * resolutionScale;
}
/** The sprite's 128px tile is a 4×4 weave, so its cells are 32px of art each. */
/** Only used if the sprite is missing. */
const ARENA_FILL = "#001b27";

/**
 * The camera's zoom, which the client keeps as two numbers: `targetZoom`, which
 * snaps from `defaultZoom` to `minZoom` the moment the score reaches
 * `minimumZoomScore`, and `gameZoom`, which chases it every frame so the change is
 * a smooth pull rather than a cut.
 *
 * The port used to read the score as a straight 0→1 ramp, which widened the view
 * by a noticeable step for every pellet eaten from the very first one — an FOV
 * that crept outward for no visible reason. `MinimumZoomScore` is a threshold in
 * the original, not the far end of a ramp.
 */
let zoomNow: number = CONFIG.defaultZoom;
let zoomAt = 0;

export function cameraFor(world: World, width: number, height: number): Camera {
  const me = world.me;
  const target = me.score >= CONFIG.minimumZoomScore ? CONFIG.minimumZoom : CONFIG.defaultZoom;
  // Frame-rate independent chase with the client's camera smoothing: about half a
  // second to settle, whatever the display is doing.
  const now = performance.now();
  const dt = zoomAt === 0 ? 0 : Math.min(64, Math.max(0, now - zoomAt));
  zoomAt = now;
  zoomNow += (target - zoomNow) * (1 - Math.exp(-dt / 180));
  if (Math.abs(target - zoomNow) < 0.0005) zoomNow = target;
  const zoom = zoomNow;
  const scale = (height / VIEW_UNITS) * zoom;
  void width;
  // Follow the interpolated head, not the last tick's: a camera that jumps ten
  // times a second is the most obvious choppiness there is.
  const head = interpolatedHead(me, world.alpha);
  return { x: head.x, y: head.y, zoom, scale };
}

/**
 * The camera behind the menu. The live page joins a room before it asks for a
 * nickname, but draws none of that room through the join screen: the menu stands
 * on the bare board, which is why this camera exists only to place the tile. It
 * is parked on the arena's middle at the client's DefaultZoom, which is the phase
 * the live page's board shows.
 */
export function menuCamera(): Camera {
  return {
    x: CONFIG.arenaWidth / 2,
    y: CONFIG.arenaHeight / 2,
    zoom: CONFIG.defaultZoom,
    scale: window.innerHeight / VIEW_UNITS,
  };
}

/**
 * One frame of the menu: the client's board and nothing else. The live join
 * screen stands on an empty room — its pellets, snakes and particles are not
 * drawn behind the dialog — so the port paints the same board and stops there.
 */
export function renderMenuBackground(
  ctx: CanvasRenderingContext2D,
  art: Art,
  quality: RenderOptions["quality"],
) {
  paintBoard(ctx, menuCamera(), art, quality);
}

export function screenToWorld(camera: Camera, canvas: HTMLCanvasElement, sx: number, sy: number) {
  return {
    x: (sx - canvas.clientWidth / 2) / camera.scale + camera.x,
    y: (sy - canvas.clientHeight / 2) / camera.scale + camera.y,
  };
}

function hueColor(hue: number, lightness = 50, alpha = 1) {
  return `hsla(${((hue % 360) + 360) % 360}, 100%, ${lightness}%, ${alpha})`;
}

/**
 * Hue for the tint cache. Every pellet rolls its own hue, so tinting at full
 * precision would cache a canvas per pellet; 12° buckets are indistinguishable
 * at these sizes and bound the cache to 30 entries.
 */
function hueBucket(hue: number, lightness = 50) {
  const bucket = Math.round((((hue % 360) + 360) % 360) / 12) * 12;
  return `hsl(${bucket}, 100%, ${lightness}%)`;
}

/**
 * The tiled board is pre-rendered into one layer, one tile wider and taller than
 * the viewport, and blitted at the scroll offset each frame. Filling a full-screen
 * pattern every frame costs about 4ms of software rasterising a frame; blitting a
 * finished bitmap at 1:1 does not.
 */
let boardLayer: { canvas: HTMLCanvasElement; tileCss: number; density: number } | null = null;

function boardLayerFor(art: Art, width: number, height: number, density: number) {
  if (!art.board) return null;
  const tileCss = BOARD_TILE_SCALE * height;
  const tileDevicePx = Math.max(1, Math.round(tileCss * density));
  const cols = Math.ceil(width / tileCss) + 1;
  const rows = Math.ceil(height / tileCss) + 1;
  const layerWidth = cols * tileDevicePx;
  const layerHeight = rows * tileDevicePx;
  if (boardLayer && boardLayer.canvas.width === layerWidth && boardLayer.canvas.height === layerHeight) {
    return boardLayer;
  }
  const canvas = document.createElement("canvas");
  canvas.width = layerWidth;
  canvas.height = layerHeight;
  const layerCtx = canvas.getContext("2d")!;
  const pattern = layerCtx.createPattern(art.board, "repeat");
  if (!pattern) return null;
  const scale = tileDevicePx / BOARD_TILE_PX;
  pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));
  layerCtx.fillStyle = pattern;
  layerCtx.fillRect(0, 0, layerWidth, layerHeight);
  boardLayer = { canvas, tileCss: tileDevicePx / density, density };
  return boardLayer;
}

/**
 * The client's board: its own 128×128 tile from `images/sheet.png`, repeated over
 * the whole viewport and anchored to the world so it slides under a moving camera.
 * Its phase falls out of anchoring the tile at the world origin, which is what the
 * client's own render does — measured, the two line up to the pixel.
 */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  art: Art,
  width: number,
  height: number,
  density: number,
) {
  const layer = boardLayerFor(art, width, height, density);
  if (!layer) {
    ctx.fillStyle = ARENA_FILL;
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const { canvas, tileCss } = layer;
  const originX = width / 2 - camera.x * camera.scale;
  const originY = height / 2 - camera.y * camera.scale;
  const phaseX = ((originX % tileCss) + tileCss) % tileCss;
  const phaseY = ((originY % tileCss) + tileCss) % tileCss;
  ctx.drawImage(
    canvas,
    Math.round(phaseX - tileCss),
    Math.round(phaseY - tileCss),
    canvas.width / density,
    canvas.height / density,
  );
}

/**
 * Sizes the canvas to the viewport and paints the board over it.
 *
 * The client renders at the display's pixel ratio on its high setting — its
 * bundle carries `defaultRetinaValue` — so its lines and its HUD are drawn at
 * native resolution and stay crisp on a retina screen. Rendering at CSS pixels
 * and letting the browser double the bitmap is what made the port's lines and
 * text look soft however smooth the motion was. Low quality still halves the
 * backing store, which is the "smaller screen size" the changelog mentions.
 *
 * Called on its own for the menu: before a player joins, the client has no world
 * at all, so nothing but this board is on its canvas.
 */
export function paintBoard(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  art: Art,
  quality: "high" | "low",
  shake?: { x: number; y: number },
) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const density = densityFor(quality);
  const backingWidth = Math.max(1, Math.round(width * density));
  const backingHeight = Math.max(1, Math.round(height * density));
  if (ctx.canvas.width !== backingWidth || ctx.canvas.height !== backingHeight) {
    ctx.canvas.width = backingWidth;
    ctx.canvas.height = backingHeight;
  }
  if (ctx.canvas.style.width !== `${width}px`) {
    ctx.canvas.style.width = `${width}px`;
    ctx.canvas.style.height = `${height}px`;
  }
  ctx.setTransform(density, 0, 0, density, 0, 0);
  // The board takes the same offset as the lines: a camera punch has to move the
  // whole frame. Moving only what is drawn over the board made the arena appear
  // to rattle inside a background that stood still.
  if (shake) ctx.translate(shake.x, shake.y);
  drawBoard(ctx, camera, art, width, height, density);
  ctx.setTransform(density, 0, 0, density, 0, 0);
  return { width, height };
}

/**
 * The camera punch after a kill. It is a damped sway, not a new random offset
 * every frame: per-frame randomness at 60fps reads as a vibration, while a pair
 * of slow sine waves reads as a camera being knocked and settling back. The
 * envelope is `shake`, which the loop drains to zero after a kill.
 */
function shakeOffset(shake: number, now: number) {
  if (shake <= 0) return { x: 0, y: 0 };
  const amplitude = 6 * shake * shake;
  return {
    x: Math.sin(now * 0.036) * amplitude,
    y: Math.cos(now * 0.027) * amplitude * 0.75,
  };
}

export function render(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  art: Art,
  options: RenderOptions,
) {
  const jitter = shakeOffset(options.shake, options.now);
  const { width, height } = paintBoard(ctx, camera, art, options.quality, jitter);

  // The simulation updates ten times a second, but the client animates its food
  // and its tail cue every frame. Anything timed off a birth or a due time has to
  // read the interpolated render clock — the same moment the snakes are drawn at
  // — or its pop-in, pulse and fade step ten times a second.
  const renderTime = world.time - (1 - world.alpha) * CONFIG.tickMs;

  ctx.save();
  ctx.translate(width / 2 + jitter.x, height / 2 + jitter.y);
  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-camera.x, -camera.y);

  const arenaWidth = CONFIG.arenaWidth;
  const arenaHeight = CONFIG.arenaHeight;
  const pxPerUnit = 1 / camera.scale;
  const quality = options.quality;

  // The board runs under everything, so the arena itself is only its wall.

  // Wall: the client's rectangle, 5000 × 1600 in its units.
  if (quality === "high") {
    ctx.shadowColor = "rgba(5, 255, 255, 0.9)";
    ctx.shadowBlur = 14;
  }
  ctx.strokeStyle = "rgba(5, 255, 255, 0.95)";
  ctx.lineWidth = Math.max(0.7, pxPerUnit * 2);
  ctx.strokeRect(0, 0, arenaWidth, arenaHeight);
  ctx.shadowBlur = 0;

  // Only the pellets on screen. The client culls too, and with a full arena of
  // 1,500 of them every off-screen pellet is a shadowed draw nobody sees.
  const pad = 28 / camera.scale;
  const halfW = width / 2 / camera.scale + pad;
  const halfH = height / 2 / camera.scale + pad;
  for (const pellet of world.pellets) {
    if (Math.abs(pellet.pos.x - camera.x) > halfW || Math.abs(pellet.pos.y - camera.y) > halfH) continue;
    drawPellet(ctx, pellet, art, renderTime);
  }

  // The client's particle pool: boost trails and death debris, behind the snakes.
  drawParticles(ctx, world, camera, width, height, art);

  // Snakes, tail first so heads stay on top. Every snake is drawn between its
  // last two ticks, so the whole board moves at the display's rate.
  //
  // Only snakes that can actually be on screen are drawn. The arena is 4.9 × 2.5
  // screens, so with thirteen bots most of them are outside the view on any
  // given frame; a body costs a shadowed polyline plus three ghost heads plus a
  // name, and drawing a dozen invisible ones every frame is the single biggest
  // avoidable cost in the renderer.
  // Enough slack for what hangs above a head — the name, the kill-streak badge
  // and the crown — so a snake at the edge does not lose its label.
  const margin = 12;
  const viewMinX = camera.x - halfW - margin;
  const viewMaxX = camera.x + halfW + margin;
  const viewMinY = camera.y - halfH - margin;
  const viewMaxY = camera.y + halfH + margin;
  const heads = new Map<Snake, Vec>();
  for (const snake of world.snakes) {
    if (!snake.alive) continue;
    let minX = snake.head.x;
    let maxX = minX;
    let minY = snake.head.y;
    let maxY = minY;
    for (const corner of snake.corners) {
      if (corner.x < minX) minX = corner.x;
      else if (corner.x > maxX) maxX = corner.x;
      if (corner.y < minY) minY = corner.y;
      else if (corner.y > maxY) maxY = corner.y;
    }
    if (maxX < viewMinX || minX > viewMaxX || maxY < viewMinY || minY > viewMaxY) continue;
    const path = interpolatedPath(snake, world.alpha);
    heads.set(snake, path[0]!);
    drawSnake(ctx, snake, path, quality, art, renderTime);
    // The client's tail-growth cue: the moment food lands on the tail it lights
    // the tail tip up and fades, so growth is something you can see coming.
    drawTailGrowth(ctx, snake, path, art, renderTime);
  }

  // Lightning where two snakes run alongside each other.
  drawElectro(ctx, world, art, options.now);

  // Names, the king's crown and the player's boost aura.
  for (const snake of world.snakes) {
    if (!snake.alive) continue;
    const head = heads.get(snake);
    if (!head) continue;
    const isKing = world.king === snake;
    if (options.names) drawName(ctx, snake, head);
    // The client stacks the crown, then the kill-streak skull, above the head.
    let stack = NAME_OFFSET;
    if (isKing) {
      const crown = frame(art, "crown");
      if (crown) sprite(ctx, crown, head.x, head.y - stack - CROWN_SIZE * 0.5, CROWN_SIZE, CROWN_SIZE * (27 / 31));
      stack += CROWN_SIZE;
    }
    if (options.killStreaks && snake.killstreak > 0) drawStreakBadge(ctx, snake, art, options.now, stack, head);
  }

  const me = world.me;
  const myHead = heads.get(me) ?? interpolatedHead(me, world.alpha);

  if (options.showBoostHint && me.alive && me.boosting === false) {
    drawBoostTutorial(ctx, me, myHead, art, options.now, world);
  }

  ctx.restore();

  if (options.hud !== false) drawHud(ctx, world, options, width, height);
}

/**
 * The boost tutorial the client teaches with (`BoostTutorialReady` in its own
 * state). It holds the `close-to-boost` sprite above the head with the line the
 * menu prints under the logo, until the player boosts for the first time: the
 * arrow bobs, the whole prompt fades in over the first moment of the run, and
 * the caption is drawn in the client's own HUD face with the same glow.
 */
function drawBoostTutorial(
  ctx: CanvasRenderingContext2D,
  me: Snake,
  head: Vec,
  art: Art,
  now: number,
  world: World,
) {
  // Fade in over the first 700ms of the run, so a fresh spawn is not buried
  // under a prompt that was already there before the snake appeared.
  const age = world.time - me.spawnedAt;
  const reveal = Math.min(1, Math.max(0, age / 700));
  const pulse = 0.72 + 0.28 * Math.sin(now / 380);
  const bob = Math.sin(now / 420) * 0.35;
  const width = 7.4;
  const height = width * 0.5;
  const top = head.y - CONFIG.snakeRadius * 2.4 - height - 0.9 + bob;

  ctx.save();
  ctx.globalAlpha = reveal * (0.55 + 0.45 * pulse);
  if (art.boostHint) {
    ctx.drawImage(art.boostHint, head.x - width / 2, top, width, height);
  }
  ctx.globalAlpha = reveal * 0.95;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 ${NAME_FONT * 0.92}px ${HUD_FONT}`;
  const caption = "GET CLOSE TO OTHER SNAKES TO BOOST";
  const y = top - 0.85;
  ctx.lineWidth = NAME_FONT * 0.3;
  ctx.strokeStyle = "rgba(0, 20, 26, 0.7)";
  ctx.strokeText(caption, head.x, y);
  ctx.fillStyle = "rgba(223, 255, 255, 0.96)";
  ctx.shadowColor = "rgba(5, 255, 255, 0.8)";
  ctx.shadowBlur = 8;
  ctx.fillText(caption, head.x, y);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * The client's pellet: its `food` sprite, tinted with the pellet's hue, scaled by
 * `0.2 - 0.02·sin(t)` and spun, popping in over its first moment alive. Drawn
 * exactly that way rather than as a soft orb — the art carries the glow.
 */
function drawPellet(ctx: CanvasRenderingContext2D, pellet: Pellet, art: Art, worldNow: number) {
  const born = Math.min(1, Math.max(0, (worldNow - pellet.bornAt) / 420));
  const pulse = 0.2 - 0.02 * Math.sin(pellet.bornAt / 300 + worldNow / 900);
  const pop = Math.sin(Math.sqrt(born) * 0.75 * Math.PI) / 0.75;
  const size = FOOD_SIZE * (pulse / 0.2) * pop;
  if (size <= 0.02) return;
  const image = frame(art, "food", hueBucket(pellet.hue));
  ctx.save();
  ctx.translate(pellet.pos.x, pellet.pos.y);
  ctx.rotate(Math.PI / 4 + (pellet.bornAt / 2600 + born) * Math.PI);
  if (image) ctx.drawImage(image, -size / 2, -size / 2, size, size);
  else if (art.food) ctx.drawImage(art.food, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/**
 * The client's particles, drawn the way its own `ParticleSystem.update()` moves
 * them: born at full speed, grown from 0.4 to 0.67 of the frame over their life,
 * faded in over the first tenth of it and out after the half, spinning.
 */
function drawParticles(
  ctx: CanvasRenderingContext2D,
  world: World,
  camera: Camera,
  width: number,
  height: number,
  art: Art,
) {
  const pad = 8;
  const halfW = width / 2 / camera.scale + pad;
  const halfH = height / 2 / camera.scale + pad;
  let additively = false;
  for (const particle of world.particles) {
    if (Math.abs(particle.x - camera.x) > halfW || Math.abs(particle.y - camera.y) > halfH) continue;
    const life = (world.clock - particle.bornAt) / particle.lifeMs;
    if (life <= 0 || life >= 1) continue;
    const grow = life < 0.1 ? 0.4 : 0.4 + 0.3 * (life - 0.1);
    const alpha = life < 0.1 ? life / 0.1 : life > 0.5 ? 1 - (life - 0.5) / 0.5 : 1;
    if (alpha <= 0.02) continue;
    const image = frame(art, "particle", hueBucket(particle.hue, 60));
    if (!image) continue;
    if (!additively) {
      ctx.globalCompositeOperation = "lighter";
      additively = true;
    }
    const size = particle.size * (grow / 0.55);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(particle.x, particle.y);
    ctx.rotate(particle.angle);
    ctx.drawImage(image, -size / 2, (-size * (19 / 14)) / 2, size, size * (19 / 14));
    ctx.restore();
  }
  if (additively) ctx.globalCompositeOperation = "source-over";
}

/**
 * The client's rubbing discharge: two snakes running alongside each other throw
 * lightning across the gap, with the `spark0`–`spark2` frames crackling through
 * the pair and a `lightning1` bolt stretched between them. Its own code gates
 * this on a head gap under 40 client units (6 here) and flickers the spark frame
 * each time the pair is drawn.
 */
function drawElectro(ctx: CanvasRenderingContext2D, world: World, art: Art, now: number) {
  const sparks = ["spark0", "spark1", "spark2"] as const;
  const step = Math.floor(now / 70) % sparks.length;
  for (const snake of world.snakes) {
    const partner = snake.rubPartner;
    if (!snake.alive || !partner || !partner.alive || snake.id > partner.id) continue;
    // The heads are drawn interpolated, so the discharge has to attach to the
    // same points: reading the raw tick positions left the bolts 6px behind and
    // stepping at 10Hz against a 60Hz board.
    const a = interpolatedHead(snake, world.alpha);
    const b = interpolatedHead(partner, world.alpha);
    const ax = a.x;
    const ay = a.y;
    const bx = b.x;
    const by = b.y;
    const gap = Math.hypot(bx - ax, by - ay);
    if (gap > 7 || gap < 0.2) continue;
    const angle = Math.atan2(by - ay, bx - ax);
    const midX = (ax + bx) / 2;
    const midY = (ay + by) / 2;
    const power = Math.min(1, Math.max(0.3, (7 - gap) / 5));
    const flicker = 0.65 + 0.35 * Math.sin(now / 45 + snake.id);
    const color = hueBucket(snake.hue, 88);
    const spark = frame(art, sparks[step]!, color);
    // The client ships three bolt frames and cycles them with the sparks; a
    // single stretched frame left the arc frozen while its own crackle moved.
    const boltFrames = ["lightning1", "lightning2", "lightning3"] as const;
    const bolt = frame(art, boltFrames[step]!, color);
    const boltGlow = frame(art, "lightningGlow", color);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (bolt) {
      const length = gap * 1.25;
      const thickness = 1.5 * power;
      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle + Math.PI / 2);
      if (boltGlow) {
        ctx.globalAlpha = 0.3 * flicker;
        ctx.drawImage(boltGlow, (-thickness * 2.4) / 2, -length / 2, thickness * 2.4, length);
      }
      ctx.globalAlpha = 0.85 * flicker;
      ctx.drawImage(bolt, -thickness / 2, -length / 2, thickness, length);
      ctx.restore();
    }
    if (spark) {
      const size = 2.6 * power;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.globalAlpha = (side < 0 ? 0.9 : 0.7) * flicker;
        ctx.translate(midX - Math.sin(angle) * side * 1.1, midY + Math.cos(angle) * side * 1.1);
        ctx.rotate(angle + Math.PI / 2);
        const tall = size * (29 / 49);
        ctx.drawImage(spark, -size / 2, -tall / 2, size, tall);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

/**
 * The point `distance` along the drawn body, measured from the head. The path is
 * a list of corners, so anything that wants a point a fixed distance behind the
 * head has to walk it rather than index it.
 */
function alongPath(points: Vec[], distance: number): Vec {
  let left = distance;
  let prev = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const next = points[i]!;
    const segment = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (segment >= left) {
      const t = segment > 0 ? left / segment : 0;
      return { x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t };
    }
    left -= segment;
    prev = next;
  }
  return prev;
}

/** The head and every corner up to `distance`, with the last segment clipped. */
function pathUpTo(points: Vec[], distance: number): Vec[] {
  const path: Vec[] = [points[0]!];
  let left = distance;
  for (let i = 1; i < points.length && left > 0; i++) {
    const prev = path[path.length - 1]!;
    const next = points[i]!;
    const segment = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (segment <= left) {
      path.push(next);
      left -= segment;
    } else {
      const t = segment > 0 ? left / segment : 0;
      path.push({ x: prev.x + (next.x - prev.x) * t, y: prev.y + (next.y - prev.y) * t });
      left = 0;
    }
  }
  return path;
}

/**
 * A snake, drawn the way the client draws one: a thin body stroke in its own hue
 * with a light core, a short white cover behind the head, the `head_dot` sprite
 * with its additive halo, and the ghost heads trailing behind it.
 */
function drawSnake(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  path: Vec[],
  quality: "high" | "low",
  art: Art,
  now: number,
) {
  const width = BODY_WIDTH;
  const points: { x: number; y: number }[] = path.slice();
  if (points.length < 2) points.push({ x: points[0]!.x, y: points[0]!.y });

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
  };

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);

  // The body: hsl(hue, 100%, 50%), with the client's 15px glow at high quality.
  if (quality === "high") {
    ctx.shadowColor = hueColor(snake.hue, 50, 0.9);
    ctx.shadowBlur = 15;
  }
  ctx.strokeStyle = hueColor(snake.hue, 50);
  ctx.lineWidth = width;
  trace();
  ctx.stroke();

  // The speed highlight the client lays over the body in 90% lightness. It
  // brightens with the actual speed now: there is no click boost to jump it to
  // full, so the rub and eat-combo speed show as a gradual charge.
  if (snake.extraSpeed > 10) {
    const strength = Math.min(1, Math.max(0, (snake.extraSpeed - 10) / 50));
    if (strength > 0) {
      ctx.shadowBlur = 0;
      ctx.globalAlpha = strength;
      ctx.strokeStyle = hueColor(snake.hue, 90);
      ctx.lineWidth = Math.max(0.12, width - 0.1);
      trace();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Very long snakes get the client's dashed white stripe over the body.
  if (snake.length > 400 && quality === "high") {
    const fade = snake.length < 500 ? 1 - (500 - snake.length) / 100 : 1;
    ctx.globalAlpha = Math.max(0, fade) * 0.9;
    ctx.shadowBlur = 5;
    ctx.strokeStyle = hueColor(snake.hue, 90);
    ctx.lineWidth = Math.max(0.1, width - 0.16);
    const dash = Math.max(0.5, width * 1.5);
    ctx.setLineDash([dash * 2.5, dash * 3]);
    ctx.lineDashOffset = -now / 60;
    trace();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0;

  // The white cover the client strokes over the neck, under the head sprite. It
  // is a short fixed collar: walking the first two path points instead drew all
  // the way to the previous corner, which are whole legs apart, so every turn
  // painted a white stripe down the body — a half-screen one on a long leg.
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = width * 1.1;
  const neck = pathUpTo(points, BODY_WIDTH * 3.2);
  if (neck.length > 1) {
    ctx.beginPath();
    ctx.moveTo(neck[0]!.x, neck[0]!.y);
    for (let i = 1; i < neck.length; i++) ctx.lineTo(neck[i]!.x, neck[i]!.y);
    ctx.stroke();
  }

  const head = points[0]!;

  // The additive halo behind the head, then the head sprite itself.
  if (quality === "high") {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const halo = frame(art, "glow", hueBucket(snake.hue));
    if (halo) {
      ctx.globalAlpha = 0.5;
      sprite(ctx, halo, head.x, head.y, HEAD_GLOW, HEAD_GLOW);
    }
    const hard = frame(art, "glowHard", hueBucket(snake.hue, 70));
    if (hard) {
      ctx.globalAlpha = 0.35;
      sprite(ctx, hard, head.x, head.y, HEAD_GLOW * 0.72, HEAD_GLOW * 0.72);
    }
    ctx.restore();
  }
  const dot = frame(art, "head", "#FFFFFF");
  if (dot) {
    sprite(ctx, dot, head.x, head.y, HEAD_SIZE, HEAD_SIZE * (46 / 47));
  } else {
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(head.x, head.y, HEAD_SIZE * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  // The three ghost heads the client leaves behind the real one: the same
  // `head_dot` sprite at 0.19, 0.16 and 0.12 of the head scale, fading out, at
  // fixed distances behind the head rather than at whichever corners exist.
  if (dot && points.length > 1) {
    const alphas = [0.5, 0.3, 0.1];
    const scales = [0.19 / 0.21, 0.16 / 0.21, 0.12 / 0.21];
    for (let i = 0; i < 3; i++) {
      const point = alongPath(points, HEAD_SIZE * (0.45 + i * 0.36));
      ctx.save();
      ctx.globalAlpha = alphas[i]!;
      const size = HEAD_SIZE * scales[i]!;
      sprite(ctx, dot, point.x, point.y, size, size * (46 / 47));
      ctx.restore();
    }
  }
}

/**
 * The client's tail-growth cue (`snake-tail-growth-glow`), ported from its own
 * snake renderer: for the growth delay the tail tip carries a white dot whose
 * radius eases from 0.45 to 1 of half the body width, under an additive halo that
 * grows with it and fades out as the tail catches up.
 */
function drawTailGrowth(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  path: Vec[],
  art: Art,
  worldTime: number,
) {
  if (!snake.growthPending) return;
  const progress = Math.min(1, Math.max(0, 1 - (snake.growthDueAt - worldTime) / CONFIG.growthDelayMs));
  if (progress <= 0) return;
  const tip = path[path.length - 1];
  if (!tip) return;
  const eased = progress * progress * (3 - 2 * progress);
  const radius = Math.max(0.18, BODY_WIDTH * 0.5 * (0.45 + 0.55 * eased));

  ctx.save();
  ctx.globalAlpha = eased;
  const halo = frame(art, "glow", "#ffffff");
  if (halo) {
    const size = radius * 16;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = eased * 0.5 * (1 + Math.min(1, snake.score / 100));
    sprite(ctx, halo, tip.x, tip.y, size, size);
    ctx.restore();
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Names are `Bold 10px` labels, white at 60%, just above the head.
 */
function drawName(ctx: CanvasRenderingContext2D, snake: Snake, head: Vec) {
  const label = (snake.nick || "snake").slice(0, 16);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${NAME_FONT}px ${HUD_FONT}`;
  ctx.lineWidth = NAME_FONT * 0.28;
  ctx.strokeStyle = "rgba(0, 20, 26, 0.55)";
  ctx.strokeText(label, head.x, head.y - NAME_OFFSET);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillText(label, head.x, head.y - NAME_OFFSET);
}

/**
 * The client's kill-streak icon: a skull above the head. Under 50 it composes
 * the sheet's skull base, glow and gradient with eyes that change colour at 8,
 * 13, 18 and 23; from 50 it uses the tinted tier skulls, one per threshold, and
 * prints the streak under it in `Bold 18px`.
 */
function drawStreakBadge(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  art: Art,
  now: number,
  stack = NAME_OFFSET,
  head: Vec = snake.head,
) {
  const streak = snake.killstreak;
  if (streak <= 0) return;
  const tierIndex = [...CONFIG.killstreakIconAt].filter((n) => streak >= n).length - 1;
  const tier = tierIndex >= 0 ? TIER_SKULLS[tierIndex] : null;

  const grow = 1 + Math.min(0.8, (streak / 100) * 0.8);
  const size = STREAK_SIZE * grow;
  const x = head.x;
  const y = head.y - stack - size * 0.62;

  ctx.save();
  ctx.translate(x, y);
  const back = frame(art, "skullBack");
  const glow = frame(art, "skullGlow", tier?.color ?? "#5ef0ff");
  const base = frame(art, "skullBase");
  const gradient = frame(art, "skullGradient", tier?.color ?? "#ffffff");
  if (back) sprite(ctx, back, 0, size * 0.08, size * 0.9, size * 0.55);
  if (glow) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 260);
    sprite(ctx, glow, 0, 0, size * 1.55, size * 1.7);
    ctx.restore();
  }
  if (base) sprite(ctx, base, 0, 0, size, size * (40 / 35));
  if (gradient) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.5;
    sprite(ctx, gradient, 0, 0, size, size * (40 / 35));
    ctx.restore();
  }
  const eye = frame(art, tier ? "eyeBlue" : eyeFrame(streak), tier?.eyes ?? eyeColor(streak));
  if (eye) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    sprite(ctx, eye, 0, -size * 0.06, size * 0.72, size * 0.33);
    ctx.restore();
  }
  ctx.restore();

  // The streak count, in the client's own 18px cyan label.
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${NAME_FONT * 1.25}px ${HUD_FONT}`;
  ctx.fillStyle = tier?.color ?? "rgba(0, 200, 255, 1)";
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 5;
  ctx.fillText(String(streak), x, y + size * 0.95);
  ctx.shadowBlur = 0;
}

/** The five tier skulls, matching CONFIG.killstreakIconAt in order. */
const TIER_SKULLS: { color: string; eyes: string }[] = [
  { color: "#89f1ff", eyes: "#d8fbff" },
  { color: "#91ffbc", eyes: "#d9ffe8" },
  { color: "#ffbe73", eyes: "#ffe7c8" },
  { color: "#e3b5ff", eyes: "#f4e2ff" },
  { color: "#ffe082", eyes: "#fff3c4" },
];

/** The client's eye colour steps: red under 13, yellow under 18, green under 23. */
function eyeFrame(streak: number): FrameName {
  return streak < 13 ? "eyeRed" : streak < 18 ? "eyeYellow" : streak < 23 ? "eyeGreen" : "eyeBlue";
}

function eyeColor(streak: number): string {
  return streak < 13 ? "#ff5a5a" : streak < 18 ? "#ffe26b" : streak < 23 ? "#8dff9c" : "#7fdcff";
}

/* -------------------------------------------------------------------- HUD -- */

function drawHud(
  ctx: CanvasRenderingContext2D,
  world: World,
  options: RenderOptions,
  width: number,
  height: number,
) {
  const me = world.me;
  ctx.textBaseline = "alphabetic";

  // The client's readouts, as its own renderer writes them: one bold 15px
  // `#09ffff` line each in the bottom-left HUD, reading “SCORE: n”, “KILLS: n”
  // and “TIME ALIVE: mm:ss”. Those strings, that size and that ink are taken
  // from the textures the live client builds every frame (`fillText` on a 19px
  // sprite canvas), so the corner reads exactly like the original's rather than
  // as the port's invented big-number typography. Its changelog names the same
  // corner when it added the Time Alive readout.
  const left = 18;
  let baseline = Math.round(height - 22);
  const line = (text: string) => {
    ctx.font = `bold ${HUD_SIZE}px ${HUD_FONT}`;
    ctx.textAlign = "left";
    // The sprite carries a dark-cyan drop shadow, not a glow: it is what keeps
    // the text legible over a bright snake and a lit board.
    ctx.shadowColor = HUD_SHADOW;
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = HUD_INK;
    ctx.fillText(text, left, baseline);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    baseline -= HUD_LINE;
  };

  line(`TIME ALIVE: ${clockText(options.timeAlive)}`);
  line(`KILLS: ${me.kills}`);
  line(`SCORE: ${me.score}`);

  const rows = options.leaderboard === "big" ? 10 : options.leaderboard === "small" ? 5 : 0;
  if (rows > 0) drawLeaderboard(ctx, world, rows, width);
  drawMinimap(ctx, world, width, height);
}

/** The client's `mm:ss` Time Alive format. */
function clockText(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * The client's own leaderboard, as its renderer builds it: a centred
 * `LEADERBOARD` header over ten rows, rank in its own column, nicknames and
 * scores right-aligned, one row per 23px, every other row at 40% cyan and your
 * own row in full `#09ffff`. When you are outside the top ten the client appends
 * your row under the list, which is why its board canvas grows by one row; the
 * port does the same instead of hiding you from your own leaderboard.
 *
 * Every string is drawn on its own measured column, so a long nickname can never
 * run into its score — the overlap the client's changelog fixed in August 2026.
 */
function drawLeaderboard(ctx: CanvasRenderingContext2D, world: World, rows: number, width: number) {
  const board = world.leaderboard();
  const top = board.slice(0, rows);
  const me = world.me;
  // Each row carries its true rank: a player outside the top ten is appended
  // under the list with the place they actually hold, not with "11.".
  const entries = top.map((snake, index) => ({ snake, rank: index + 1 }));
  if (me.alive && !top.includes(me)) entries.push({ snake: me, rank: board.indexOf(me) + 1 });
  const panelWidth = 283;
  const left = width - panelWidth - 14;
  const right = left + panelWidth - 14;

  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `700 15.5px ${HUD_FONT}`;
  ctx.fillStyle = HUD_INK;
  ctx.shadowColor = HUD_SHADOW;
  ctx.shadowBlur = 3;
  ctx.fillText("LEADERBOARD", left + panelWidth / 2, 20);
  ctx.shadowBlur = 0;

  let y = 43;
  for (const { snake, rank } of entries) {
    const mine = snake === me;
    ctx.fillStyle = mine ? HUD_INK : "rgba(0, 255, 255, 0.4)";
    ctx.font = `bold 14.7px ${HUD_FONT}`;

    // Rank and score are drawn from fixed edges; the nickname takes whatever
    // room is between them and is clipped rather than overlapping the score.
    ctx.textAlign = "left";
    const rankText = `${rank}.`;
    ctx.fillText(rankText, left + 9, y);
    const nameLeft = left + 9 + ctx.measureText(rankText).width + 9;
    const scoreWidth = ctx.measureText(String(snake.score)).width;
    const nameRoom = right - scoreWidth - 12 - nameLeft;
    ctx.fillText(clampText(ctx, snake.nick || "snake", nameRoom), nameLeft, y);

    ctx.textAlign = "right";
    ctx.fillText(String(snake.score), right, y);
    y += 23;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/** `text`, shortened with an ellipsis until it fits `room` pixels. */
function clampText(ctx: CanvasRenderingContext2D, text: string, room: number) {
  if (ctx.measureText(text).width <= room) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > room) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** The corner map the original keeps in the bottom right. */
function drawMinimap(ctx: CanvasRenderingContext2D, world: World, width: number, height: number) {
  // The arena is a rectangle, so the map is too: 132px wide, in the client's
  // 5000:1600 proportion.
  const mapWidth = 132;
  const mapHeight = Math.round((mapWidth * CONFIG.arenaHeight) / CONFIG.arenaWidth);
  const pad = 16;
  const left = width - mapWidth - pad;
  const top = height - mapHeight - pad;

  ctx.fillStyle = "rgba(0, 32, 42, 0.55)";
  ctx.strokeStyle = "rgba(5, 255, 255, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(left, top, mapWidth, mapHeight);
  ctx.fill();
  ctx.stroke();

  const innerWidth = mapWidth - 14;
  const innerHeight = mapHeight - 14;
  const toMap = (x: number, y: number) => ({
    x: left + 7 + (x / CONFIG.arenaWidth) * innerWidth,
    y: top + 7 + (y / CONFIG.arenaHeight) * innerHeight,
  });

  for (const snake of world.snakes) {
    if (!snake.alive) continue;
    const head = interpolatedHead(snake, world.alpha);
    const pos = toMap(head.x, head.y);
    const mine = snake === world.me;
    ctx.fillStyle = mine ? "#ffffff" : hueColor(snake.hue, 55, 0.85);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, mine ? 2.6 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}
