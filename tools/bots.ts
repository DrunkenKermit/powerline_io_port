// Diagnostic: why do bots die so fast? Runs the engine headless for 60s.
import { World, type Snake } from "../game/engine.ts";

const world = new World("Me", 190);
const lifetimes: number[] = [];
const reasons: Record<string, number> = {};
const prev = new Map<number, { alive: boolean; spawned: number; score: number }>();

// Track the head position per tick to catch lateral teleports (lane snaps).
const lastHead = new Map<number, { x: number; y: number; spawned: number }>();
let jumps: Array<[number, number, number]> = []; // id, jump, from-dir

for (let t = 0; t < 60000; t += 100) {
  world.step(100);
  world.drainEvents();
  for (const snake of world.snakes) {
    const before = prev.get(snake.id) ?? { alive: true, spawned: 0, score: 0 };
    if (before.alive && !snake.alive) {
      reasons[snake.reason ?? "?"] = (reasons[snake.reason ?? "?"] ?? 0) + 1;
      lifetimes.push(world.time - snake.spawnedAt);
    }
    prev.set(snake.id, { alive: snake.alive, spawned: snake.spawnedAt, score: snake.score });

    if (snake.alive) {
      const was = lastHead.get(snake.id);
      if (was && was.spawned === snake.spawnedAt) {
        const jump = Math.hypot(snake.head.x - was.x, snake.head.y - was.y);
        // A straight lane step is <= baseSpeed * ticksPerStep * boost(2) = 1.5.
        if (jump > 1.6) jumps.push([snake.id, jump, snake.isBot ? 1 : 0]);
      }
      lastHead.set(snake.id, { x: snake.head.x, y: snake.head.y, spawned: snake.spawnedAt });
    }
  }
  if (t % 10000 === 0) {
    console.log(`t=${(t / 1000).toFixed(0)}s alive=${world.leaderboard().length}`);
  }
}

const sorted = [...lifetimes].sort((a, b) => a - b);
console.log("deaths:", lifetimes.length, "reasons:", reasons);
console.log(
  "bot lifetime ms: median",
  sorted[Math.floor(sorted.length / 2)]?.toFixed(0),
  "p90",
  sorted[Math.floor(sorted.length * 0.9)]?.toFixed(0),
  "max",
  sorted[sorted.length - 1]?.toFixed(0),
);
jumps.sort((a, b) => b[1] - a[1]);
console.log("teleport jumps > 1.6 units:", jumps.length, "worst:", jumps.slice(0, 5));
console.log("final alive:", world.leaderboard().length, "of", world.snakes.length);
