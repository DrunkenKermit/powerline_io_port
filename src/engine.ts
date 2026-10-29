// Simulation.
//
// The constants below follow the game's own client config and the community
// server that speaks its protocol: ArenaSize 300, UpdateInterval 100ms, FoodValue
// 1.5, DefaultLength 10, MaxRubSpeed 200, DefaultZoom 2, MinimumZoom 2 / 1.4.
// Snakes turn in 90-degree lanes picked by the cursor.
//
// Speed comes from two places, both the original's: riding alongside another line
// (the powerslide) and chaining pellets. There is no click-to-boost.

export const CONFIG = {
  /**
   * The client's arena is a rectangle: 5000 × 1600 in its units. Drawn here at
   * 6⅔× the scale (a 2.78 body becomes 0.42), so the same rectangle is 750 × 240
   * and the walls land where they do in the original.
   */
  arenaWidth: 750,
  arenaHeight: 240,
  /** UpdateInterval — the server ticks 10 times a second. */
  tickMs: 100,
  /** UPDATE_EVERY_N_TICKS — a snake advances speed * this each tick. */
  ticksPerStep: 3,
  /** Snake.speed on spawn, in world units per tick-step. */
  baseSpeed: 0.25,
  defaultLength: 10,
  foodValue: 1.5,
  scoreMultiplier: 10 / 1.5,
  /** Speed cap: `0.25 + extraSpeed / 1000` with extraSpeed capped here, so
   * 0.45 a step, 1.8× base. */
  maxRubSpeed: 200,
  /** extraSpeed above which a snake is drawn as speeding (bright body, trail). */
  speedGlowThreshold: 10,
  /** MaxRubAcceleration: a rub adds `(MaxRubAcceleration - 1) × (5 - distance) / 4`
   * to extraSpeed per tick. */
  rubAcceleration: 4,
  /** How fast a rub wears off once the snakes part, per tick (reference: 1). */
  rubDecay: 1,
  /** Eat combo: pellets eaten within the window stack, and from the fifth on the
   * snake gains extra speed per tick (still capped at MaxRubSpeed). */
  eatComboSize: 5,
  eatComboWindowMs: 500,
  eatComboAcceleration: 2,

  /** Head gap at which two snakes are rubbing (40 client units). */
  rubRange: 6,
  /** Geometry. */
  snakeRadius: 1.4,
  /**
   * Distance between two heads at which they are rubbing, and the radius a head
   * dies within on another snake's body. A body is 0.42 wide, so this is its
   * half-width plus the head sprite's core: two snakes can weave past each other,
   * but not through each other.
   */
  collisionRadius: 0.55,
  /** Two head sprites side by side are 1.66 units of ink, so at this distance a
   * crash reads as head-on rather than one line hitting a body. */
  headOnRadius: 1.65,
  /**
   * Body immediately behind the head that is skipped when testing a snake against
   * itself. The neck has to swing through where the head just turned; past a
   * couple of units the trail counts, including your own.
   */
  selfSkip: 2,
  /**
   * Reach from the head's centre to a pellet's centre, where the two sprites'
   * ink meets: 0.425 of the food frame plus 0.44 of the head, 2.83 + 1.20 over
   * their drawn sizes.
   */
  eatRadius: 2.03,
  /** Camera: `defaultZoom 1.4`, `minZoom 1`, `minZoomScore 100` in the client, so
   * the view pulls out 1.4× at score 100. 2 is this game's equivalent of 1.4. */
  defaultZoom: 2,
  zoomLevel2: 10,
  minimumZoom: 2 / 1.4,
  minimumZoomScore: 100,
  /** Leaderboard of 10; the top snake wears the crown. */
  leaderboardSize: 10,
  /** The client's killstreak icons, per the live build's October 2026 changelog. */
  killstreakIconAt: [50, 100, 250, 500, 1000],
  /**
   * Tail growth is delayed, so a snake visibly swells a moment after it eats and
   * can be seen coming. The live build's changelog added the delay and the cue.
   */
  growthDelayMs: 600,
  /** Energy lost when a snake dies: 10%, the value the live build settled on. */
  deathEnergyLoss: 0.1,
  /** A real server spawns `ArenaSize * 5` pellets: 1,500 across the arena. */
  naturalFood: 1500,
  botCount: 13,
  /** Cap on live particles. The client pools and budgets these for the same reason. */
  maxParticles: 700,
  /** How far from the player bots pick waypoints, and where they turn back. The
   * arena is only 2.5 screens tall, so both are tight. */
  botRoam: 110,
  /** Past this distance a bot stops wandering and heads back to the crowd. */
  botLeash: 160,
  /** How often a bot re-plans, and how often it misses a threat and dies. */
  botThinkMs: 300,
  botLapse: 0.1,
  /**
   * A turn is held this long, and only breaks once the input is this far off the
   * current lane — otherwise a target on the diagonal flips direction every tick.
   */
  turnCooldownMs: 300,
  turnMargin: 0.35,
  /** Shortest leg before the next turn. One step is 0.75, so a double tap cannot
   * stack two corners on the same point. */
  minLegLength: 0.7,
  /** Same, for bots. Long enough that a snake does not box itself in, short
   * enough that it turns about once a second like a player. */
  botMinLegLength: 7,
  /** Bots ignore pellets this close: chasing one on top of the head spins them. */
  botMinChase: 10,
  botNames: [
    "Ripple", "Nova", "Kobra", "Zephyr", "Mamba", "Vortex", "Hydra", "Quasar",
    "Bandit", "Pixel", "Blitz", "Cobra", "Nyx", "Onyx", "Talon", "Viper",
    "Comet", "Rogue", "Ace", "Jinx", "Echo", "Fable", "Gizmo", "Halo",
    "Indy", "Jolt", "Kilo", "Lynx", "Myth", "Nitro", "Orbit", "Pulse",
  ],
} as const;

export type Vec = { x: number; y: number };
export type KillReason = "wall" | "snake" | "self";

export const DIR = { NONE: 0, UP: 1, LEFT: 2, DOWN: 3, RIGHT: 4 } as const;
export type Dir = (typeof DIR)[keyof typeof DIR];

const LANES: Dir[] = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];
const BOT_TRAITS = ["greedy", "hunter", "drifter"] as const;
export type BotTrait = (typeof BOT_TRAITS)[number];

/** The lane behind this one — a snake can never turn into it. */
function opposite(dir: Dir): Dir {
  if (dir === DIR.UP) return DIR.DOWN;
  if (dir === DIR.DOWN) return DIR.UP;
  if (dir === DIR.LEFT) return DIR.RIGHT;
  return dir === DIR.RIGHT ? DIR.LEFT : DIR.NONE;
}

/**
 * Aims a snake down a lane. Steering only reads which side of the head the
 * target falls on, so a point a thousand units away is enough to name the lane.
 */
function aimLane(snake: Snake, dir: Dir) {
  if (dir === DIR.UP) snake.target = { x: snake.head.x, y: -1e3 };
  else if (dir === DIR.DOWN) snake.target = { x: snake.head.x, y: 1e3 };
  else if (dir === DIR.LEFT) snake.target = { x: -1e3, y: snake.head.y };
  else snake.target = { x: 1e3, y: snake.head.y };
}

/**
 * The lane leaving `pos` with the most board ahead of it. A new snake used to
 * always leave the spawn facing right, so one that landed in the right-hand
 * strip drove into the barrier within a second or two — before the player's
 * first mouse move could turn it. The live client's spawns never do that.
 */
function safestLane(pos: Vec): Dir {
  const lanes: Array<[Dir, number]> = [
    [DIR.RIGHT, CONFIG.arenaWidth - pos.x],
    [DIR.LEFT, pos.x],
    [DIR.DOWN, CONFIG.arenaHeight - pos.y],
    [DIR.UP, pos.y],
  ];
  let best: [Dir, number] = lanes[0]!;
  for (const lane of lanes) if (lane[1] > best[1]) best = lane;
  return best[0];
}

export interface Pellet {
  id: number;
  pos: Vec;
  hue: number;
  /** Snake that dropped this pellet — its killer may not eat it instantly. */
  owner: number;
  bornAt: number;
}

export interface Snake {
  id: number;
  nick: string;
  hue: number;
  isBot: boolean;
  alive: boolean;
  /** Lane the snake is travelling along. */
  dir: Dir;
  head: Vec;
  /**
   * Where the head and the body were at the previous tick. The client sends
   * positions ten times a second and interpolates between them over its own
   * `INTERP_TIME`; without the same the head and the camera step 6px at a time
   * and the whole game reads as choppy even at 60fps. Points are never mutated
   * in place — a turn or a trim replaces them — so these hold references safely.
   */
  prevHead: Vec;
  prevCorners: Vec[];
  /** Corners, newest first; the head itself is tracked separately. */
  corners: Vec[];
  length: number;
  score: number;
  killstreak: number;
  kills: number;
  /**
   * Whether the snake is currently speeding (extraSpeed past the glow
   * threshold). Drives the bright body overlay, the particle trail and the hum.
   * There is no click boost: speed comes from rubbing and from eat combos.
   */
  boosting: boolean;
  extraSpeed: number;
  /** When this snake last ate, and how many pellets it has chained since. */
  lastAte: number;
  combo: number;
  /** Steering target in world units (the player's cursor, or a bot's plan). */
  target: Vec;
  spawnedAt: number;
  diedAt: number;
  topPosition: number;
  killer: string;
  reason: KillReason | null;
  /**
   * Whether this tick changed the shape of the trail: a turn added a corner at
   * the head, or the tail was cut back. The body is only eased between the last
   * two ticks when the two corner lists line up point for point — after a shape
   * change index 0 of the new list is a different corner from index 0 of the old
   * one, and blending them dragged the whole snake a corner sideways for the
   * length of the tick. The client never eases a corner that has just moved.
   */
  pathChanged: boolean;
  /**
   * Fractional boost-trail particle carried between frames. The client's particle
   * system is driven by the display, not by the 10Hz update, so its trail is a
   * continuous stream; emitting two particles per tick here made the trail step
   * ten times a second next to snakes and particles that do not. This accumulator
   * spends a particle at the same rate across every frame instead.
   */
  trailAcc: number;
  /** Bot think timer. */
  think: number;
  /** Ticks of commitment left before the snake will turn again. */
  turnCooldown: number;
  /** Growth eaten but not yet on the tail. */
  pendingGrowth: number;
  /** When that growth lands, and so when the cue shows. */
  growthDueAt: number;
  growthPending: boolean;
  /**
   * Bot personality, fixed for the snake's life: `greedy` chases pellets harder
   * and further, `hunter` cuts across the player's line, `drifter` roams wide.
   * A board of thirteen identical planners reads as one snake copied thirteen
   * times; the live board is thirteen different players.
   */
  ai: { mode: "food" | "hunt" | "flee"; wander: Vec; trait: BotTrait };
  /**
   * The snake this one is rubbing against, if any — heads within 4.5 units.
   * The client draws its lightning arcs and sparks between the two, so the
   * renderer needs to know who the partner is, not just that it is rubbing.
   */
  rubPartner: Snake | null;
  /**
   * How close the rub is, 0 (at the edge of `rubRange`) to 1 (touching). The
   * reference server weights the rub by `(5 - distance) / 4`, and the client
   * scales both the spark's volume (`VOLUME_SPARK * lastDistVolume`) and the
   * trail by the same figure, so the sound needs the distance, not just a flag.
   */
  rubCloseness: number;
}

/**
 * One particle, in the client's own terms: it is born at the emitter, drifts at
 * `vx`/`vy` (units per millisecond), spins, and lives `lifeMs` — its
 * `ParticleSystem` keeps `life` at 400ms by default.
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** World clock at birth, ms. */
  bornAt: number;
  lifeMs: number;
  hue: number;
  size: number;
  angle: number;
  spin: number;
}

export type GameEvent =
  | { type: "kill"; killer: string; victim: string; streak: number; king: boolean }
  | { type: "wasKilled"; by: string; reason: KillReason };

const SPAWN_CLEARANCE = 26;
/**
 * How far behind its own head a snake looks when avoiding itself. The first leg
 * always runs through the head, so the neck has to be excluded or every bot would
 * read its own head as a body in every lane; 14 units is roughly three body
 * lengths, which is past the segment a turn can fold back onto.
 */
const SELF_SKIP = 6;
/**
 * How far from the nearest snake a bot rejoining the action is placed. Tight
 * enough that it lands in view of the player, loose enough that it is not born
 * inside the kill it is about to be blamed for.
 */
const NEAR_RING = 70;

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

/** Which side of a→b the point c falls on: >0, <0, or 0 when collinear. */
function orientation(a: Vec, b: Vec, c: Vec) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Strict segment intersection — the reference server's `MapFunctions.DoIntersect`.
 * Touching at an endpoint, or two segments lying along the same line, do not
 * count: that is what keeps the neck segment from killing its own snake.
 */
function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** How far a point lies from a segment. */
function pointSegmentDistance(p: Vec, a: Vec, b: Vec) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return dist(p.x, p.y, a.x + dx * t, a.y + dy * t);
}

/**
 * Whether two segments pass within `reach` of each other. This is the collision
 * the live client actually resolves: a snake's body is 2.78 of its own units
 * wide, so a head that comes within that width of another snake dies, whether
 * it crosses the line, touches it end-on, or runs alongside it. The strict
 * crossing test alone let snakes slide through each other along parallel lanes
 * and through the exact endpoints at every corner — the pass-through exploit the
 * client's October 2026 patch closed.
 */
function segmentsWithin(a: Vec, b: Vec, c: Vec, d: Vec, reach: number) {
  if (segmentsCross(a, b, c, d)) return true;
  return (
    pointSegmentDistance(a, c, d) < reach ||
    pointSegmentDistance(b, c, d) < reach ||
    pointSegmentDistance(c, a, b) < reach ||
    pointSegmentDistance(d, a, b) < reach
  );
}

export class World {
  snakes: Snake[] = [];
  pellets: Pellet[] = [];
  me: Snake;
  time = 0;
  events: GameEvent[] = [];
  king: Snake | null = null;
  /** Debris, boost trails and eat puffs — the client's particle pool. */
  particles: Particle[] = [];
  /**
   * A millisecond clock that advances every frame, not every tick: particles
   * move smoothly between updates the way the client's do.
   */
  clock = 0;
  /** Fraction of the way from the last tick's positions to this tick's, 0–1. */
  alpha = 0;
  private nextId = 1;
  private nextPellet = 1;
  private accumulator = 0;
  /** Steering input for the player, in world units. */
  input: Vec = { x: 0, y: 0 };

  constructor(nick: string, hue: number) {
    this.me = this.spawn(nick, hue, false);
    for (let i = 0; i < CONFIG.botCount; i++) {
      const bot = this.spawn(this.botName(i), Math.random() * 360, true);
      // Bots start with a spread of lengths so the board looks lived-in.
      bot.length = CONFIG.defaultLength + Math.random() * 26;
      bot.score = this.scoreOf(bot);
      // And on their own heading: thirteen snakes all leaving the spawn facing
      // the same way is the one thing the live board never shows.
      bot.dir = LANES[Math.floor(Math.random() * LANES.length)]!;
      aimLane(bot, bot.dir);
    }
    for (let i = 0; i < CONFIG.naturalFood; i++) this.addPellet(null);
    this.updateKing();
  }

  private botName(seed: number) {
    const names = CONFIG.botNames;
    return `${names[seed % names.length]!}${seed >= names.length ? Math.floor(seed / names.length) : ""}`;
  }

  scoreOf(snake: Snake) {
    return Math.max(0, Math.round((snake.length - CONFIG.defaultLength) * CONFIG.scoreMultiplier));
  }

  /**
   * A free spot in the arena. The client's changelog draws a line between the two
   * uses: joining places you closer to the action, while respawning after death is
   * deliberately less likely to drop you into the middle of it.
   *
   * Nothing here avoids pellets. A full arena holds 1,500 of them, so a hard "clear
   * of every pellet" rule rejects nearly every candidate and quietly falls back to
   * the arena centre — which put every spawn on top of every other one.
   */
  private freeSpot(clearance = SPAWN_CLEARANCE, mode: "near" | "away" = "away"): Vec {
    const pad = 12;
    let best: Vec | null = null;
    // Nearest wants the spot closest to `NEAR_RING` from the crowd; farthest
    // wants the emptiest spot on the board.
    let bestDistance = mode === "near" ? Infinity : -Infinity;
    for (let attempt = 0; attempt < 60; attempt++) {
      const pos = {
        x: pad + Math.random() * (CONFIG.arenaWidth - pad * 2),
        y: pad + Math.random() * (CONFIG.arenaHeight - pad * 2),
      };
      let nearest = Infinity;
      for (const snake of this.snakes) {
        if (!snake.alive) continue;
        nearest = Math.min(nearest, dist(pos.x, pos.y, snake.head.x, snake.head.y));
      }
      if (nearest < clearance) continue;
      // Heads are not enough: a snake is up to a few hundred units of body, and
      // spawning across one is an instant collision.
      if (clearance > 0 && this.overlapsBody(pos, clearance)) continue;
      // Respawns pick the emptiest spot, but never one the player is looking at:
      // a bot appearing out of nowhere beside you is a death you cannot read.
      if (mode === "away" && this.me?.alive && dist(pos.x, pos.y, this.me.head.x, this.me.head.y) < 85) continue;
      // A bot rejoining "."in the action" used to take the tightest free spot,
      // which is right beside the last kill — where the debris, the body and the
      // next snake all are. It rejoins a short run away instead: close enough to
      // be seen, far enough to be read.
      if (mode === "near" && this.me?.alive) {
        const gap = dist(pos.x, pos.y, this.me.head.x, this.me.head.y);
        if (gap < 45) continue;
      }
      if (mode === "near") {
        const rank = Math.abs(nearest - NEAR_RING);
        if (rank < bestDistance) {
          bestDistance = rank;
          best = pos;
        }
      } else if (nearest > bestDistance || best === null) {
        bestDistance = nearest;
        best = pos;
      }
    }
    return best ?? { x: CONFIG.arenaWidth / 2, y: CONFIG.arenaHeight / 2 };
  }

  /** Whether a point comes within `clearance` of any living snake's body. */
  private overlapsBody(pos: Vec, clearance: number) {
    for (const snake of this.snakes) {
      if (!snake.alive || snake === this.me) continue;
      let prev = snake.head;
      for (const corner of snake.corners) {
        const dx = corner.x - prev.x;
        const dy = corner.y - prev.y;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((pos.x - prev.x) * dx + (pos.y - prev.y) * dy) / len2)) : 0;
        if (dist(pos.x, pos.y, prev.x + dx * t, prev.y + dy * t) < clearance) return true;
        prev = corner;
      }
    }
    return false;
  }

  spawn(nick: string, hue: number, isBot: boolean, placement: "near" | "away" = "near"): Snake {
    const pos = this.freeSpot(SPAWN_CLEARANCE, placement);
    const snake: Snake = {
      id: this.nextId++,
      nick,
      hue,
      isBot,
      alive: true,
      dir: safestLane(pos),
      head: { x: pos.x, y: pos.y },
      prevHead: { x: pos.x, y: pos.y },
      corners: [{ x: pos.x, y: pos.y }],
      prevCorners: [{ x: pos.x, y: pos.y }],
      length: CONFIG.defaultLength,
      score: 0,
      killstreak: 0,
      kills: 0,
      boosting: false,
      extraSpeed: 0,
      lastAte: 0,
      combo: 0,
      target: { x: pos.x + 10, y: pos.y },
      spawnedAt: this.time,
      diedAt: 0,
      topPosition: 0,
      killer: "",
      reason: null,
      think: 0,
      turnCooldown: 0,
      pathChanged: false,
      trailAcc: 0,
      pendingGrowth: 0,
      growthDueAt: 0,
      growthPending: false,
      ai: {
        mode: "food",
        wander: { x: Math.random(), y: Math.random() },
        trait: BOT_TRAITS[this.snakes.length % BOT_TRAITS.length]!,
      },
      rubPartner: null,
      rubCloseness: 0,
    };
    // The lane chosen above is the snake's first heading, so its target has to
    // be the far end of that lane rather than the placeholder to the right.
    aimLane(snake, snake.dir);
    this.snakes.push(snake);
    // The client spawns a snake with a puff of its own colour.
    this.burst(pos, 8, { speed: 0.03, lifeMs: 420, hue, size: 0.8 });
    return snake;
  }

  /**
   * Drops a player into a room that is already running, reusing the dead slot the
   * menu's placeholder holds. This is what the live client does: it joins a room
   * before it asks for a nickname, draws that arena behind the join screen, and
   * then puts you into the same room — the snakes you were watching are the ones
   * you meet, rather than a fresh board appearing on Enter.
   */
  joinMe(nick: string, hue: number) {
    const index = this.snakes.indexOf(this.me);
    const fresh = this.spawn(nick, hue, false, "near");
    this.snakes.pop();
    if (index >= 0) this.snakes.splice(index, 1, fresh);
    else this.snakes.push(fresh);
    this.me = fresh;
    // Hold the spawn lane until the pointer names another one.
    this.input = { ...fresh.target };
    return fresh;
  }

  respawnMe(nick: string, hue: number) {
    const index = this.snakes.indexOf(this.me);
    // The live build's respawn algorithm is deliberately less likely to drop you
    // into the middle of the action; `"away"` is that rule.
    const fresh = this.spawn(nick, hue, false, "away");
    // spawn() appends; move the fresh snake into the slot the dead one held so the
    // arena order stays put. Overwriting the old slot without taking the appended
    // copy back out would leave the snake in the arena twice — and a snake sitting
    // on top of itself is an instant collision, so you would die on respawn.
    this.snakes.pop();
    if (index >= 0) this.snakes.splice(index, 1, fresh);
    else this.snakes.push(fresh);
    this.me = fresh;
    // Hold the spawn lane until the pointer names another one. Aiming due right
    // here drove a respawn near the right wall straight into it.
    this.input = { ...fresh.target };
    return fresh;
  }

  /**
   * Natural food lands anywhere inside the arena, the way the original's does —
   * `Food.js` takes a random free position, with no spacing rule of its own.
   */
  private randomPelletPos(): Vec {
    return { x: Math.random() * CONFIG.arenaWidth, y: Math.random() * CONFIG.arenaHeight };
  }

  addPellet(at: Vec | null, hue?: number, owner = 0, spread = 0): Pellet {
    const raw = at
      ? { x: at.x + (Math.random() - 0.5) * spread, y: at.y + (Math.random() - 0.5) * spread }
      : this.randomPelletPos();
    // A snake dying against a wall scatters its trail just past it. Keep every
    // pellet inside the arena so none of the food sits behind the boundary.
    const pos = {
      x: Math.min(CONFIG.arenaWidth - 0.5, Math.max(0.5, raw.x)),
      y: Math.min(CONFIG.arenaHeight - 0.5, Math.max(0.5, raw.y)),
    };
    const pellet: Pellet = {
      id: this.nextPellet++,
      pos,
      hue: hue ?? Math.round(Math.random() * 360),
      owner,
      bornAt: this.time,
    };
    this.pellets.push(pellet);
    return pellet;
  }

  /** Distance along the snake from its head to its tail. */
  pathLength(snake: Snake) {
    let total = 0;
    let prev = snake.head;
    for (const corner of snake.corners) {
      total += dist(prev.x, prev.y, corner.x, corner.y);
      prev = corner;
    }
    return total;
  }

  /** Drop corners that lie past `length` so the tail follows the head. */
  private trim(snake: Snake) {
    let total = 0;
    let prev = snake.head;
    let keep = 0;
    for (; keep < snake.corners.length; keep++) {
      const corner = snake.corners[keep]!;
      const segment = dist(prev.x, prev.y, corner.x, corner.y);
      if (total + segment > snake.length) break;
      total += segment;
      prev = corner;
    }
    if (keep >= 1 && keep < snake.corners.length) {
      const corner = snake.corners[keep]!;
      const segment = dist(prev.x, prev.y, corner.x, corner.y);
      const remaining = snake.length - total;
      const t = segment > 0 ? remaining / segment : 0;
      snake.corners[keep] = {
        x: prev.x + (corner.x - prev.x) * t,
        y: prev.y + (corner.y - prev.y) * t,
      };
      keep += 1;
    } else {
      keep = Math.max(1, keep);
    }
    if (snake.corners.length > keep) {
      snake.corners.length = keep;
      snake.pathChanged = true;
    }
  }

  private advance(snake: Snake, step: number) {
    switch (snake.dir) {
      case DIR.UP:
        snake.head.y -= step;
        break;
      case DIR.DOWN:
        snake.head.y += step;
        break;
      case DIR.LEFT:
        snake.head.x -= step;
        break;
      case DIR.RIGHT:
        snake.head.x += step;
        break;
      default:
        break;
    }
  }

  /**
   * Steering, following the original's server: the snake holds its lane and turns
   * 90 degrees when the input points off it, turning where it stands so the body
   * follows round the corner. The head only ever moves one step per tick — a turn
   * that snapped it onto a far-away lane would drag it across its own trail and
   * kill the snake instantly.
   */
  private steer(snake: Snake) {
    const { target } = snake;
    const dx = target.x - snake.head.x;
    const dy = target.y - snake.head.y;
    const across = Math.abs(dx);
    const down = Math.abs(dy);
    const movingX = snake.dir === DIR.LEFT || snake.dir === DIR.RIGHT;
    // A target sitting on the head is not a direction: every small mouse move at
    // the centre of the screen would flip the lane. The client throttles input at
    // a distance for the same reason, so within that distance the lane is held.
    if (Math.hypot(dx, dy) < Math.max(1.2, CONFIG.turnMargin * 2)) return;
    // Hold the lane until the input points off it by a clear margin, so a target
    // sitting on the diagonal cannot make the snake jitter between two turnings.
    const corner = snake.corners[0]!;
    const leg = Math.hypot(snake.head.x - corner.x, snake.head.y - corner.y);
    // A bot evading a threat has to be able to turn now: the long leg that keeps
    // its wandering calm also used to hold it in a lane that was about to kill it
    // for three or four steps after it had already chosen a way out. Its 300ms
    // turn cooldown still keeps it from zig-zagging.
    const minLeg = !snake.isBot
      ? CONFIG.minLegLength
      : snake.ai.mode === "flee"
        ? CONFIG.minLegLength
        : CONFIG.botMinLegLength;
    if (leg < minLeg) return;
    // The server turns a player on the input that arrives, with no cooldown of its
    // own; only the bots plan on a timer. A 300ms hold here put half a second of
    // lag between two taps of the mouse.
    const turnNow = snake.dir === DIR.NONE || !snake.isBot || snake.turnCooldown <= 0;
    if (!turnNow) return;
    // Turn only when the *other* axis is ahead by a margin. Both margins used to
    // sit on the same side of the same comparison, so a cursor inside a band
    // around the 45-degree diagonal satisfied both "keep this lane" tests: the
    // snake turned, found the new lane equally diagonal, turned back, and went on
    // flipping between the two lanes every tick. One margin, applied to the axis
    // the snake is not on, is a hysteresis with no overlap — on the diagonal the
    // lane it is on simply holds, as it does in the client.
    const switchAxis = movingX ? down > across + CONFIG.turnMargin : across > down + CONFIG.turnMargin;
    if (!switchAxis) return; // still on the lane, or pointed backwards: a snake cannot reverse
    const wanted: Dir = movingX ? (dy > 0 ? DIR.DOWN : DIR.UP) : dx > 0 ? DIR.RIGHT : DIR.LEFT;
    snake.corners.unshift({ x: snake.head.x, y: snake.head.y });
    snake.pathChanged = true;
    snake.dir = wanted;
    snake.turnCooldown = CONFIG.turnCooldownMs;
  }

  /**
   * The pellet worth a detour. A pellet behind the head is discounted by the
   * two turns it costs to come back for it: taking the nearest pellet flat made
   * a bot reverse every other think, which read as twitchy and wasted more
   * ground than the orb was worth. Pellets in front win ties.
   */
  private nearestPellet(snake: Snake, radius: number) {
    const dirX = snake.dir === DIR.LEFT ? -1 : snake.dir === DIR.RIGHT ? 1 : 0;
    const dirY = snake.dir === DIR.UP ? -1 : snake.dir === DIR.DOWN ? 1 : 0;
    let best: Pellet | null = null;
    let bestScore = radius;
    for (const pellet of this.pellets) {
      const dx = pellet.pos.x - snake.head.x;
      const dy = pellet.pos.y - snake.head.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= radius) continue;
      const ahead = dirX * dx + dirY * dy >= 0;
      const score = distance * (ahead ? 0.75 : 1.4);
      if (score < bestScore) {
        bestScore = score;
        best = pellet;
      }
    }
    return best;
  }

  /**
   * Danger ahead: how close the closest body is along our heading. The snake's
   * own trail counts too, from `SELF_SKIP` behind its head: a bot that only
   * looked at other snakes would happily choose a lane that crosses its own body,
   * which was the second most common way bots died (a quarter of all deaths in a
   * three-minute soak).
   */
  private dangerAhead(snake: Snake, reach: number, dir: Dir) {
    const probe = { x: snake.head.x, y: snake.head.y };
    const step = 2;
    for (let travelled = step; travelled <= reach; travelled += step) {
      switch (dir) {
        case DIR.UP:
          probe.y = snake.head.y - travelled;
          break;
        case DIR.DOWN:
          probe.y = snake.head.y + travelled;
          break;
        case DIR.LEFT:
          probe.x = snake.head.x - travelled;
          break;
        default:
          probe.x = snake.head.x + travelled;
          break;
      }
      if (probe.x < 4 || probe.y < 4 || probe.x > CONFIG.arenaWidth - 4 || probe.y > CONFIG.arenaHeight - 4) return travelled;
      for (const other of this.snakes) {
        if (!other.alive) continue;
        if (this.pointHitsBody(other, probe.x, probe.y, other === snake ? SELF_SKIP : 0)) return travelled;
      }
    }
    return reach + 1;
  }

  /** Distance from the head to the wall down a lane. */
  private wallMargin(snake: Snake, dir: Dir) {
    const { x, y } = snake.head;
    if (dir === DIR.UP) return y;
    if (dir === DIR.DOWN) return CONFIG.arenaHeight - y;
    if (dir === DIR.LEFT) return x;
    return CONFIG.arenaWidth - x;
  }

  /**
   * How far down a lane another head is coming at this snake — the hazard
   * `dangerAhead` cannot see, because it only looks for bodies. A head-on hit
   * kills this snake too, so an oncoming head is a reason to leave a lane even
   * when the lane itself is wide open.
   */
  private headOnAhead(snake: Snake, reach: number, dir: Dir) {
    let nearest = Infinity;
    for (const other of this.snakes) {
      if (!other.alive || other === snake) continue;
      const dx = other.head.x - snake.head.x;
      const dy = other.head.y - snake.head.y;
      const along = dir === DIR.UP ? -dy : dir === DIR.DOWN ? dy : dir === DIR.LEFT ? -dx : dx;
      if (along <= 0 || along > reach) continue;
      // Only a head running back up the lane is a head-on: one going the same way
      // is just traffic, and treating it as a threat had bots swerving out of
      // their lane every few steps.
      if (other.dir !== opposite(dir)) continue;
      const across = dir === DIR.UP || dir === DIR.DOWN ? Math.abs(dx) : Math.abs(dy);
      if (across > CONFIG.headOnRadius) continue;
      nearest = Math.min(nearest, along);
    }
    return nearest;
  }

  /**
   * Whether another snake's body already sits within a body width or two of the
   * head down this lane. A turn is made where the snake stands, so the lane it is
   * turning into has to be clear at the head, not just out at the probe's range.
   */
  private nearBlocked(snake: Snake, dir: Dir) {
    for (let travelled = 2; travelled <= 7; travelled += 1.5) {
      const x = snake.head.x + (dir === DIR.LEFT ? -travelled : dir === DIR.RIGHT ? travelled : 0);
      const y = snake.head.y + (dir === DIR.UP ? -travelled : dir === DIR.DOWN ? travelled : 0);
      if (x < 2 || y < 2 || x > CONFIG.arenaWidth - 2 || y > CONFIG.arenaHeight - 2) return true;
      for (const other of this.snakes) {
        if (!other.alive) continue;
        if (this.pointHitsBody(other, x, y, other === snake ? SELF_SKIP : 0)) return true;
      }
    }
    return false;
  }

  /**
   * Whether a point comes within a body's death reach of any snake — exactly the
   * test `touchesBody` uses, evaluated at one point. The lane probes used to walk
   * each body's path in half-unit samples to ask the same question; the exact
   * point-to-segment distance is both faster and cannot step past a thin edge.
   */
  private pointHitsBody(snake: Snake, x: number, y: number, skip: number) {
    let travelled = 0;
    let prev = snake.head;
    for (const corner of snake.corners) {
      const segment = dist(prev.x, prev.y, corner.x, corner.y);
      if (travelled + segment >= skip) {
        // Only the part of the segment past `skip` counts, so the neck a snake is
        // still turning off is not read as a wall in front of it.
        const start = segment > 0 ? Math.max(0, (skip - travelled) / segment) : 0;
        const from = start > 0 ? { x: prev.x + (corner.x - prev.x) * start, y: prev.y + (corner.y - prev.y) * start } : prev;
        if (pointSegmentDistance({ x, y }, from, corner) < CONFIG.collisionRadius) return true;
      }
      travelled += segment;
      if (travelled > snake.length + 1) break;
      prev = corner;
    }
    return false;
  }

  /**
   * Heads that are about to cross the first stretch of this lane. A body is a
   * wall that stays put, but a head moving across the lane arrives where the
   * snake will be: turning into a lane at the moment another line sweeps through
   * it is a kill with no body in sight, and the old scoring could not see it.
   */
  private crossingHeads(snake: Snake, dir: Dir) {
    const vertical = dir === DIR.UP || dir === DIR.DOWN;
    let penalty = 0;
    for (const other of this.snakes) {
      if (!other.alive || other === snake) continue;
      // Only a head crossing the lane: one running along it is either ahead of
      // the snake (a body `dangerAhead` already counts) or behind it.
      const theirVertical = other.dir === DIR.UP || other.dir === DIR.DOWN;
      if (theirVertical === vertical) continue;
      const dx = other.head.x - snake.head.x;
      const dy = other.head.y - snake.head.y;
      const along = dir === DIR.UP ? -dy : dir === DIR.DOWN ? dy : dir === DIR.LEFT ? -dx : dx;
      const across = vertical ? Math.abs(dx) : Math.abs(dy);
      if (along <= 0 || along > 12 || across > CONFIG.collisionRadius * 5) continue;
      penalty = Math.max(penalty, 22 - along);
    }
    return penalty;
  }

  /**
   * How many ways out a lane leads to. `laneScore` sees how far a lane is clear;
   * it cannot see the pocket at the end of that clear stretch. Probing a couple
   * of points down the lane and asking whether either perpendicular is open
   * there is the two-step look a player makes by eye, and it keeps a bot from
   * committing to a lane that is eighteen units long and then walled in.
   */
  private escapeRoom(snake: Snake, dir: Dir, reach: number) {
    let exits = 0;
    const sides = dir === DIR.UP || dir === DIR.DOWN ? [DIR.LEFT, DIR.RIGHT] : [DIR.UP, DIR.DOWN];
    for (const along of [9, 17]) {
      if (along > reach) break;
      const x = snake.head.x + (dir === DIR.LEFT ? -along : dir === DIR.RIGHT ? along : 0);
      const y = snake.head.y + (dir === DIR.UP ? -along : dir === DIR.DOWN ? along : 0);
      if (x < 4 || y < 4 || x > CONFIG.arenaWidth - 4 || y > CONFIG.arenaHeight - 4) break;
      if (this.anyBodyAt(snake, x, y)) break;
      for (const side of sides) {
        const exitX = x + (side === DIR.LEFT ? -9 : side === DIR.RIGHT ? 9 : 0);
        const exitY = y + (side === DIR.UP ? -9 : side === DIR.DOWN ? 9 : 0);
        if (exitX < 3 || exitY < 3 || exitX > CONFIG.arenaWidth - 3 || exitY > CONFIG.arenaHeight - 3) continue;
        if (this.anyBodyAt(snake, exitX, exitY)) continue;
        exits += 1;
        break;
      }
    }
    return exits;
  }

  /** Whether a point is inside any snake's death reach. */
  private anyBodyAt(snake: Snake, x: number, y: number) {
    for (const other of this.snakes) {
      if (!other.alive) continue;
      if (this.pointHitsBody(other, x, y, other === snake ? SELF_SKIP : 0)) return true;
    }
    return false;
  }

  /** One number for a lane: room ahead, heads coming back, the wall, and exits. */
  private laneScore(snake: Snake, dir: Dir, reach: number) {
    const clearance = Math.min(this.dangerAhead(snake, reach, dir), reach);
    const oncoming = this.headOnAhead(snake, reach, dir);
    const wall = this.wallMargin(snake, dir);
    let score = clearance;
    if (oncoming < reach) score -= 20 + (reach - oncoming) * 0.9;
    if (wall < 18) score -= (18 - wall) * 1.7;
    score -= this.crossingHeads(snake, dir);
    // Worth a little: a clear lane always beats a clogged one, but between two
    // equally clear lanes the one that can still turn at the far end is safer.
    score += this.escapeRoom(snake, dir, reach) * 6;
    return score;
  }

  /** The lane that runs most nearly toward a point. */
  private laneToward(snake: Snake, point: Vec): Dir {
    const dx = point.x - snake.head.x;
    const dy = point.y - snake.head.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? DIR.RIGHT : DIR.LEFT;
    return dy > 0 ? DIR.DOWN : DIR.UP;
  }

  /** Bots decide every `botThinkMs`, and now and then miss a threat. */
  private botThink(snake: Snake) {
    snake.think -= CONFIG.tickMs;
    if (snake.think > 0) return;
    snake.think = CONFIG.botThinkMs * (0.7 + Math.random() * 0.6);

    const reach = 30 + snake.length * 0.4;
    const trait = snake.ai.trait;
    const ahead = this.dangerAhead(snake, reach, snake.dir);
    const oncoming = this.headOnAhead(snake, reach, snake.dir);
    // A head sweeping across this lane is a body that is not there yet: the lane
    // reads clear right up to the moment the other line arrives in it, which is
    // how a bot used to drive into a kill with nothing in front of it.
    const crossing = this.crossingHeads(snake, snake.dir);
    const hazard = ahead < 30 || oncoming < 36 || crossing > 12;

    // A closing lane is re-read on the next tick or two instead of a third of a
    // second later. The old fixed 300ms meant a bot that turned into a tight
    // pocket had already committed two body lengths before it saw the far side
    // of it; the turn cooldown still keeps it from flipping lane to lane.
    if (hazard) snake.think = 90 + Math.random() * 40;
    else if (ahead < 30 || oncoming < 36) snake.think = 140 + Math.random() * 50;

    // Something in the lane — a body, the wall, a head coming the other way, or a
    // head about to cross it: take the clearest lane instead. Bots used to only
    // ever turn sideways, so a blocked snake turned into the same wall twice and
    // died on the third try.
    if (hazard && Math.random() > CONFIG.botLapse) {
      // Take the best perpendicular lane whenever the lane ahead is closing: a
      // bot that waits for a lane to be clearly better spends those few steps
      // driving into the body it has already seen. The two perpendicular lanes
      // are checked close to the head as well — `dangerAhead` starts its probe
      // six units out, which is already too late for a turn taken where it stands.
      let best: Dir | null = null;
      let bestScore = -Infinity;
      for (const dir of LANES) {
        if (dir === snake.dir || dir === opposite(snake.dir)) continue;
        if (this.nearBlocked(snake, dir)) continue;
        const score = this.laneScore(snake, dir, reach);
        if (score > bestScore) {
          bestScore = score;
          best = dir;
        }
      }
      // Nothing is clear: both ways out are already close to a body. Driving on
      // into the thing in front of it is certain death, so take whichever side
      // has more room — a bad lane is still better than a wall of snake.
      if (!best && (ahead < 12 || oncoming < 14)) {
        let fallback = -Infinity;
        for (const dir of LANES) {
          if (dir === snake.dir || dir === opposite(snake.dir)) continue;
          const score = this.laneScore(snake, dir, reach);
          if (score > fallback) {
            fallback = score;
            best = dir;
          }
        }
      }
      if (best) {
        snake.ai.mode = "flee";
        aimLane(snake, best);
        return;
      }
    }

    // Roam around the player rather than the arena's middle: the live game's
    // bots mill around wherever the players are, and on a 4.9 × 2.5-screen board
    // a bot heading for the far corner simply leaves you alone for a minute.
    const centre = this.me.alive ? this.me.head : { x: CONFIG.arenaWidth / 2, y: CONFIG.arenaHeight / 2 };
    const fromCrowd = dist(snake.head.x, snake.head.y, centre.x, centre.y);
    const home = fromCrowd > CONFIG.botLeash;

    // A hunter aims at a point in front of the player rather than at the player:
    // that is the cut-off a human tries, and it gives the board a predator that
    // is dangerous without being perfect. It only tries while it is a fair match.
    let huntAt: Vec | null = null;
    if (trait === "hunter" && !home && this.me !== snake && this.me.alive) {
      const me = this.me;
      const gap = dist(snake.head.x, snake.head.y, me.head.x, me.head.y);
      if (gap < 85 && snake.length > me.length * 0.55) {
        const lead = Math.min(24, gap * 0.5);
        const vx = Math.abs(me.target.x - me.head.x) > 0.01 ? Math.sign(me.target.x - me.head.x) : 0;
        const vy = Math.abs(me.target.y - me.head.y) > 0.01 ? Math.sign(me.target.y - me.head.y) : 0;
        const cut = { x: me.head.x + vx * lead, y: me.head.y + vy * lead };
        // Never cut across the player's own trail: that is a free kill for them.
        if (this.dangerAhead(snake, Math.min(reach, 24), this.laneToward(snake, cut)) >= 14) huntAt = cut;
      }
    }

    // Food, if it is worth the detour and the lane to it is not blocked. The
    // lane check matters as much as the distance: the nearest pellet can sit on
    // the far side of a body, and a bot that only weighed the pellet would turn
    // straight into it. In that case it wanders this think instead of chasing.
    const pellet = home || huntAt ? null : this.nearestPellet(snake, (trait === "greedy" ? 78 : 52) + snake.length);
    if (pellet && ahead > 22 && dist(snake.head.x, snake.head.y, pellet.pos.x, pellet.pos.y) > CONFIG.botMinChase) {
      const lane = this.laneToward(snake, pellet.pos);
      if (this.dangerAhead(snake, 26, lane) >= 18) {
        snake.ai.mode = "food";
        snake.target = pellet.pos;
        return;
      }
    }

    // Wander: drift toward a slowly drifting waypoint, but always pick the
    // clearest of the four lanes so bots do not mill into walls.
    const roam = home ? 65 : CONFIG.botRoam * (trait === "drifter" ? 1.5 : 1);
    const waypoint = huntAt ?? {
      x: Math.min(CONFIG.arenaWidth - 10, Math.max(10, centre.x + (snake.ai.wander.x - 0.5) * roam * 2)),
      y: Math.min(CONFIG.arenaHeight - 10, Math.max(10, centre.y + (snake.ai.wander.y - 0.5) * roam * 2)),
    };
    snake.ai.mode = huntAt ? "hunt" : "food";
    snake.ai.wander = {
      x: Math.min(1, Math.max(0, snake.ai.wander.x + (Math.random() - 0.5) * 0.12)),
      y: Math.min(1, Math.max(0, snake.ai.wander.y + (Math.random() - 0.5) * 0.12)),
    };

    let bestDir = snake.dir;
    let bestScore = -Infinity;
    for (const dir of LANES) {
      // A snake cannot reverse; scoring its own back lane would only ever tie.
      if (dir === opposite(snake.dir)) continue;
      const probe = { x: snake.head.x, y: snake.head.y };
      if (dir === DIR.UP) probe.y -= 22;
      if (dir === DIR.DOWN) probe.y += 22;
      if (dir === DIR.LEFT) probe.x -= 22;
      if (dir === DIR.RIGHT) probe.x += 22;
      if (probe.x < 8 || probe.y < 8 || probe.x > CONFIG.arenaWidth - 8 || probe.y > CONFIG.arenaHeight - 8) continue;
      const gun = Math.hypot(probe.x - waypoint.x, probe.y - waypoint.y) < Math.hypot(snake.head.x - waypoint.x, snake.head.y - waypoint.y) ? 10 : 0;
      const score = this.laneScore(snake, dir, reach) * 0.65 + gun;
      if (score > bestScore) {
        bestScore = score;
        bestDir = dir;
      }
    }
    aimLane(snake, bestDir);
  }

  /**
   * Does the head's step — `from` to `to` — run into this snake's own trail?
   *
   * The trail is tested with the same reach as any other body. A strict
   * crossing test cannot work here: the head moves in fixed steps along lanes,
   * so a snake doubling back onto its own line lands exactly *on* it, and
   * collinear or endpoint contact is not a crossing — every self-collision in
   * the game was silently ignored, and you could drive straight through your
   * own line. The first `selfSkip` units behind the head are ignored so a turn
   * cannot kill its own neck, the same few units the client leaves out.
   */
  private hitsOwnBody(snake: Snake, from: Vec, to: Vec) {
    const reach = CONFIG.collisionRadius;
    const skip = CONFIG.selfSkip;
    let travelled = 0;
    let prev = snake.head;
    for (const corner of snake.corners) {
      const segment = dist(prev.x, prev.y, corner.x, corner.y);
      const end = travelled + segment;
      if (end > skip) {
        // The one segment that straddles the skip is cut where the skip ends;
        // everything closer to the head than that is the neck.
        const start =
          travelled >= skip || segment === 0
            ? prev
            : {
                x: prev.x + (corner.x - prev.x) * ((skip - travelled) / segment),
                y: prev.y + (corner.y - prev.y) * ((skip - travelled) / segment),
              };
        if (segmentsWithin(from, to, start, corner, reach)) return true;
      }
      travelled = end;
      if (travelled > snake.length + 1) break;
      prev = corner;
    }
    return false;
  }

  /**
   * Did the two heads meet this tick? Both heads move in the same tick, so the
   * test is the two swept steps against each other with a head sprite's width as
   * the reach — the same geometry the renderer draws, rather than the distance
   * between the two end points, which misses a pair that swaps sides in one step.
   */
  private headsMet(snake: Snake, other: Snake) {
    return segmentsWithin(snake.prevHead, snake.head, other.prevHead, other.head, CONFIG.headOnRadius);
  }

  /**
   * Does the head's step — `from` to `to` — come within a body's reach of another
   * snake? This is the death test between snakes: it catches the crossing case,
   * two snakes running along each other, and a head running into a corner, none
   * of which a bare crossing test sees.
   */
  private touchesBody(other: Snake, from: Vec, to: Vec) {
    const reach = CONFIG.collisionRadius;
    if (pointSegmentDistance(other.head, from, to) < reach) return true;
    let travelled = 0;
    let prev = other.head;
    for (const corner of other.corners) {
      if (segmentsWithin(from, to, prev, corner, reach)) return true;
      travelled += dist(prev.x, prev.y, corner.x, corner.y);
      if (travelled > other.length + 1) break;
      prev = corner;
    }
    return false;
  }

  /**
   * Eat every pellet the head passed over this tick. The server sweeps its item
   * list and eats each one in reach; this loop used to stop at the first, so a
   * death trail — a dozen orbs in a line a step apart — gave up one pellet per
   * 100ms while the rest slid through the head untouched.
   *
   * The test is the swept step from `prevHead` to `head`, not the head's end
   * point. The renderer draws the head interpolated between those two points, so
   * an end-point test collected orbs up to one tick's travel before the drawn
   * head arrived: at boost speed that is a whole body length of empty board
   * between the head and the orb that just vanished.
   */
  private eatPellets(snake: Snake) {
    if (this.pellets.length === 0) return;
    const eaten: Pellet[] = [];
    for (const pellet of this.pellets) {
      if (pellet.owner === snake.id && this.time - pellet.bornAt < 900) continue;
      if (pointSegmentDistance(pellet.pos, snake.prevHead, snake.head) >= CONFIG.eatRadius) continue;
      eaten.push(pellet);
    }
    for (const pellet of eaten) this.eatPellet(snake, pellet);
  }

  private eatPellet(snake: Snake, pellet: Pellet) {
    const index = this.pellets.indexOf(pellet);
    if (index >= 0) this.pellets.splice(index, 1);
    // The tail follows a beat later; the head shows the cue while it catches up.
    this.burst(pellet.pos, 3, { speed: 0.02, lifeMs: 260, hue: pellet.hue, size: 0.5 });
    snake.pendingGrowth += CONFIG.foodValue;
    // Only the first pellet starts the delay. Restarting it on every pellet meant
    // a snake eating steadily — the normal case in a field of food — never reached
    // its due time, so its length and score stood still until it stopped.
    if (!snake.growthPending) {
      snake.growthPending = true;
      snake.growthDueAt = this.time + CONFIG.growthDelayMs;
    }
    // The combo the reference server runs: a pellet eaten within half a second of
    // the previous one extends the streak, and five in a row light the line up.
    snake.combo =
      snake.lastAte > 0 && this.time - snake.lastAte <= CONFIG.eatComboWindowMs ? snake.combo + 1 : 0;
    snake.lastAte = this.time;
    snake.score = this.scoreOf(snake);
  }

  private applyGrowth(snake: Snake) {
    if (!snake.growthPending || this.time < snake.growthDueAt) return;
    snake.length += snake.pendingGrowth;
    snake.pendingGrowth = 0;
    snake.growthPending = false;
    snake.score = this.scoreOf(snake);
  }

  private dropFood(snake: Snake, at: Vec, amount: number) {
    const count = Math.max(1, Math.round(amount / CONFIG.foodValue));
    for (let i = 0; i < count; i++) this.addPellet(at, snake.hue - 15 + Math.random() * 30, snake.id, 3);
  }

  /**
   * The client's particle emitter, reduced to what its own class does: a burst
   * of dots born at a point, each drifting on its own heading at `speed`
   * units-per-millisecond, spinning, for `lifeMs`.
   */
  burst(
    at: Vec,
    count: number,
    options: { speed: number; lifeMs: number; hue: number; size: number; spread?: number; angle?: number },
  ) {
    const spread = options.spread ?? Math.PI * 2;
    const base = options.angle ?? Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= CONFIG.maxParticles) this.particles.shift();
      const heading = base + (Math.random() - 0.5) * spread;
      const speed = options.speed * (0.55 + Math.random() * 0.9);
      this.particles.push({
        x: at.x + (Math.random() - 0.5) * 1.2,
        y: at.y + (Math.random() - 0.5) * 1.2,
        vx: Math.cos(heading) * speed,
        vy: Math.sin(heading) * speed,
        bornAt: this.clock,
        lifeMs: options.lifeMs * (0.75 + Math.random() * 0.5),
        hue: options.hue + (Math.random() - 0.5) * 24,
        size: options.size * (0.7 + Math.random() * 0.6),
        angle: Math.random() * Math.PI * 2,
        spin: ((Math.random() - 0.5) / 12) * 1000,
      });
    }
  }

  /**
   * Advances the particle pool by a real frame. Called every frame rather than
   * every tick — the client's particles move at the display's rate, which is
   * also why a 10Hz burst still looks smooth.
   */
  updateParticles(dtMs: number) {
    const dt = Math.min(dtMs, 100);
    this.clock += dt;

    // The boost trail, at the display's rate: 60 particles a second behind any
    // boosting head, thrown backwards along its lane and drifting apart. At 2 a
    // tick it was 20 a second in clumps of two, which reads as a stutter next to
    // the trail the client draws.
    for (const snake of this.snakes) {
      if (!snake.alive || !snake.boosting) {
        snake.trailAcc = 0;
        continue;
      }
      const head = interpolatedHead(snake, this.alpha);
      const dirX = snake.dir === DIR.LEFT ? -1 : snake.dir === DIR.RIGHT ? 1 : 0;
      const dirY = snake.dir === DIR.UP ? -1 : snake.dir === DIR.DOWN ? 1 : 0;
      snake.trailAcc += dt * 0.06;
      while (snake.trailAcc >= 1) {
        snake.trailAcc -= 1;
        this.burst(
          { x: head.x - dirX * 1.6, y: head.y - dirY * 1.6 },
          1,
          { speed: 0.014, lifeMs: 380, hue: snake.hue, size: 0.7, spread: 0.9, angle: Math.atan2(-dirY, -dirX) },
        );
      }
    }
    let keep = 0;
    for (const particle of this.particles) {
      const age = this.clock - particle.bornAt;
      if (age > particle.lifeMs) continue;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.angle += (particle.spin * dt) / 1000;
      this.particles[keep++] = particle;
    }
    this.particles.length = keep;
  }

  leaderboard() {
    return [...this.snakes].filter((s) => s.alive).sort((a, b) => b.score - a.score);
  }

  updateKing() {
    this.king = this.leaderboard()[0] ?? null;
  }

  kill(snake: Snake, reason: KillReason, killer: Snake | null) {
    if (!snake.alive) return;
    // Was this the leading snake? The kill confirmation has its own crown variant
    // for taking the king down, so the event has to carry it.
    const wasKing = this.king === snake;
    snake.alive = false;
    snake.diedAt = this.time;
    snake.reason = reason;
    snake.killer = killer ? killer.nick : "";
    snake.rubPartner = null;
    snake.rubCloseness = 0;
    // Freeze the entity interpolation at the death point. A dead snake stops
    // moving, but the renderer keeps easing between "last tick" and "this tick"
    // every 100ms — so the camera, which follows the interpolated head, slid a
    // whole step back and forth behind the death screen. That was the shaking
    // that survived every shake fix.
    snake.prevHead = { x: snake.head.x, y: snake.head.y };
    snake.prevCorners = snake.corners.map((corner) => ({ x: corner.x, y: corner.y }));
    // Death throws the snake's own colour outward — the client's debris burst.
    this.burst(snake.head, 20, { speed: 0.05, lifeMs: 620, hue: snake.hue, size: 0.95 });
    if (killer && killer !== snake) {
      killer.kills += 1;
      killer.killstreak += 1;
    }
    if (snake === this.me) this.events.push({ type: "wasKilled", by: killer ? killer.nick : reason === "wall" ? "the wall" : "yourself", reason });
    // Only the player's own kills are announced. This used to fire for every kill
    // on the board, so a bot eating a bot put "YOU KILLED <name>" on screen.
    else if (killer === this.me) this.events.push({ type: "kill", killer: this.me.nick, victim: snake.nick, streak: this.me.killstreak, king: wasKing });

    // Death leaves the trail behind as food, less the energy the live build's
    // changelog settled at 10% — spread along the body rather than in a heap.
    const energy = snake.length * (1 - CONFIG.deathEnergyLoss);
    const pellets = Math.max(1, Math.round(energy / CONFIG.foodValue));
    const gap = Math.max(0.6, Math.min(snake.length, this.pathLength(snake)) / pellets);
    let prev = snake.head;
    let travelled = 0;
    for (const corner of snake.corners) {
      const segment = dist(prev.x, prev.y, corner.x, corner.y);
      for (let along = 0; along < segment; along += gap) {
        if (travelled + along >= snake.length) break;
        const t = segment > 0 ? along / segment : 0;
        this.dropFood(snake, { x: prev.x + (corner.x - prev.x) * t, y: prev.y + (corner.y - prev.y) * t }, CONFIG.foodValue);
      }
      travelled += segment;
      if (travelled >= snake.length) break;
      prev = corner;
    }
  }

  /** Bots come back a few seconds after dying, so the arena stays populated. */
  private respawnBot(snake: Snake) {
    // Bots rejoin near the crowd, never on top of a head or a body (freeSpot
    // enforces both). Respawn used to use the player's "away" rule, which keeps
    // 85 units of empty board around you and drains the arena with every death.
    const pos = this.freeSpot(SPAWN_CLEARANCE, "near");
    snake.head = { x: pos.x, y: pos.y };
    snake.prevHead = { x: pos.x, y: pos.y };
    snake.corners = [{ x: pos.x, y: pos.y }];
    snake.prevCorners = [{ x: pos.x, y: pos.y }];
    snake.dir = DIR.RIGHT;
    snake.target = { x: pos.x + 12, y: pos.y };
    snake.length = CONFIG.defaultLength + Math.random() * 12;
    snake.score = this.scoreOf(snake);
    snake.killstreak = 0;
    snake.kills = 0;
    snake.turnCooldown = 0;
    snake.pathChanged = false;
    snake.trailAcc = 0;
    snake.pendingGrowth = 0;
    snake.growthDueAt = 0;
    snake.growthPending = false;
    snake.boosting = false;
    snake.extraSpeed = 0;
    snake.lastAte = 0;
    snake.combo = 0;
    snake.alive = true;
    snake.rubPartner = null;
    snake.rubCloseness = 0;
    snake.spawnedAt = this.time;
    snake.diedAt = 0;
    snake.reason = null;
    snake.killer = "";
    snake.topPosition = 0;
    snake.hue = Math.random() * 360;
    snake.think = 0;
    snake.ai = {
      mode: "food",
      wander: { x: Math.random(), y: Math.random() },
      trait: BOT_TRAITS[Math.floor(Math.random() * BOT_TRAITS.length)]!,
    };
    snake.dir = LANES[Math.floor(Math.random() * LANES.length)]!;
    aimLane(snake, snake.dir);
    // The client puffs a fresh snake in; a bot that blinks into place reads as a
    // teleport rather than a spawn.
    this.burst(pos, 8, { speed: 0.03, lifeMs: 420, hue: snake.hue, size: 0.8 });
  }

  /** One simulation tick: 100ms of the original's server. */
  private tick() {
    this.time += CONFIG.tickMs;
    for (const snake of this.snakes) {
      if (!snake.alive) {
        if (snake.isBot && this.time - snake.diedAt > 2500) this.respawnBot(snake);
        continue;
      }
      snake.prevHead = { x: snake.head.x, y: snake.head.y };
      snake.prevCorners = snake.corners.slice();
      snake.pathChanged = false;
      if (snake.turnCooldown > 0) snake.turnCooldown -= CONFIG.tickMs;
      if (snake.combo > 0 && this.time - snake.lastAte > CONFIG.eatComboWindowMs) snake.combo = 0;
      this.applyGrowth(snake);
      if (snake.isBot) this.botThink(snake);
      else snake.target = { x: this.input.x, y: this.input.y };

      this.steer(snake);
      // The reference server's only speed term: base plus extraSpeed, capped by
      // MaxRubSpeed. A held mouse no longer doubles it — the original has no
      // click boost; the powerslide is the proximity bonus below.
      const speed = CONFIG.baseSpeed + snake.extraSpeed / 1000;
      this.advance(snake, speed * CONFIG.ticksPerStep);
      this.trim(snake);

      this.eatPellets(snake);

      // Rubbing: running alongside another snake winds you up a touch.
      let rubbing = false;
      let partner: Snake | null = null;
      // The client rubs at a 40-client-unit head gap — 6 here. Two heads crash
      // inside 1.65, so a rub window narrower than that could never fire without
      // killing the pair; 6 leaves room for the spark to bridge the gap.
      let nearest: number = CONFIG.rubRange;
      for (const other of this.snakes) {
        if (other === snake || !other.alive) continue;
        const gap = dist(snake.head.x, snake.head.y, other.head.x, other.head.y);
        if (gap < nearest) {
          nearest = gap;
          rubbing = true;
          partner = other;
        }
      }
      snake.rubPartner = partner;
      // The reference server applies the rub and the eat combo independently, and
      // decays extraSpeed only while neither is feeding it.
      const percentOfMax = rubbing ? Math.max(0, (5 - Math.max(1, nearest)) / 4) : 0;
      snake.rubCloseness = percentOfMax;
      if (rubbing) {
        snake.extraSpeed = Math.min(CONFIG.maxRubSpeed, snake.extraSpeed + (CONFIG.rubAcceleration - 1) * percentOfMax);
      }
      if (snake.combo >= CONFIG.eatComboSize) {
        // Five pellets in a row wind the line up, the way the reference server's
        // eatCombo does: +2 speed a tick while the streak is alive, up to the cap.
        snake.extraSpeed = Math.min(CONFIG.maxRubSpeed, snake.extraSpeed + CONFIG.eatComboAcceleration);
      }
      if (!rubbing && snake.combo < CONFIG.eatComboSize) {
        snake.extraSpeed = Math.max(0, snake.extraSpeed - CONFIG.rubDecay);
      }
      // Speeding is a consequence of the two, not an input: the bright body, the
      // trail and the hum all follow the speed itself.
      snake.boosting = snake.extraSpeed > CONFIG.speedGlowThreshold;
      snake.score = this.scoreOf(snake);

      // Walls: the reference server kills the moment the head crosses the
      // boundary, with no radius.
      if (snake.head.x < 0 || snake.head.y < 0 || snake.head.x > CONFIG.arenaWidth || snake.head.y > CONFIG.arenaHeight) {
        this.kill(snake, "wall", null);
        continue;
      }
      // The snake's own trail, from where its head was at the start of the tick.
      if (this.hitsOwnBody(snake, snake.prevHead, snake.head)) {
        this.kill(snake, "self", null);
        continue;
      }
      // Other snakes, resolved by what was actually hit. A head that runs into a
      // body dies, whatever the two lengths are — the old rule let a longer snake
      // ram a shorter one's body and survive, because both heads happening to be
      // within a head-sprite's width was read as a head-on. Only two heads meeting
      // each other is a head-on, and there the shorter line goes first.
      for (const other of this.snakes) {
        if (other === snake || !other.alive) continue;
        if (this.headsMet(snake, other)) {
          if (snake.length > other.length + 0.01) this.kill(other, "snake", snake);
          else if (other.length > snake.length + 0.01) {
            this.kill(snake, "snake", other);
            break;
          } else {
            this.kill(snake, "snake", other);
            this.kill(other, "snake", snake);
            break;
          }
          continue;
        }
        if (this.touchesBody(other, snake.prevHead, snake.head)) {
          this.kill(snake, "snake", other);
          break;
        }
      }
    }

    // Keep the pellet field topped up and retire old food. Natural pellets stay at
    // the 1,500 a real server spawns; the food a death or a boost drops is extra,
    // but with thirteen bots eating less than a full server of players the field
    // used to drift to the hard cap and stay 70% denser than the original. The
    // oldest dropped pellets are retired once the field is a fifth over its
    // natural size, so a body's trail is still there to be eaten — it just does
    // not accumulate for ever.
    const natural = this.pellets.filter((p) => p.owner === 0).length;
    for (let i = natural; i < CONFIG.naturalFood; i++) this.addPellet(null);
    const fieldCap = Math.round(CONFIG.naturalFood * 1.2);
    if (this.pellets.length > fieldCap) {
      let excess = this.pellets.length - fieldCap;
      this.pellets = this.pellets.filter((pellet) => {
        if (excess > 0 && pellet.owner !== 0 && this.time - pellet.bornAt > 8000) {
          excess -= 1;
          return false;
        }
        return true;
      });
    }
    if (this.pellets.length > 2600) this.pellets.splice(0, this.pellets.length - 2600);

    const board = this.leaderboard();
    board.forEach((snake, index) => {
      if (index < CONFIG.leaderboardSize) snake.topPosition = Math.max(snake.topPosition, index + 1);
    });
    this.updateKing();
  }

  /** Advance the simulation by a real frame's worth of milliseconds. */
  step(dtMs: number) {
    this.accumulator += Math.min(dtMs, 300);
    while (this.accumulator >= CONFIG.tickMs) {
      this.accumulator -= CONFIG.tickMs;
      this.tick();
    }
    // The client's INTERP_TIME is one update — 100ms, this same tick — so the
    // renderer draws where a smooth 60fps client would put the snake: partway
    // from last tick's position to this one.
    this.alpha = Math.min(1, this.accumulator / CONFIG.tickMs);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

/**
 * Where a snake's head is `alpha` of the way from the last tick to this one —
 * the client's own entity interpolation, over the same 100ms update window.
 */
export function interpolatedHead(snake: Snake, alpha: number): Vec {
  const prev = snake.prevHead;
  if (alpha >= 1) return snake.head;
  return { x: prev.x + (snake.head.x - prev.x) * alpha, y: prev.y + (snake.head.y - prev.y) * alpha };
}

/**
 * The whole body at that moment: the head eased forward, every corner eased from
 * where it was. Corners only change when a turn adds one or the tail is trimmed,
 * so when the two lists differ the current one is used as-is — the shape is
 * right either way, and the trail is never stretched across itself.
 */
export function interpolatedPath(snake: Snake, alpha: number): Vec[] {
  const points: Vec[] = [interpolatedHead(snake, alpha)];
  const prev = snake.prevCorners;
  const blend = alpha < 1 && !snake.pathChanged && prev.length === snake.corners.length;
  for (let i = 0; i < snake.corners.length; i++) {
    const current = snake.corners[i]!;
    if (!blend) {
      points.push(current);
      continue;
    }
    const before = prev[i]!;
    points.push({ x: before.x + (current.x - before.x) * alpha, y: before.y + (current.y - before.y) * alpha });
  }
  return points;
}
