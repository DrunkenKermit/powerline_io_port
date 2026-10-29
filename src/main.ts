// Client. Wires the menu markup to the simulation: nickname entry, settings,
// the death screen and its stat cards, the kill confirmation, the About overlay,
// and the canvas HUD.

import { CONFIG, DIR, World, type Dir, type Snake } from "./engine.ts";
import { sound } from "./audio.ts";
import {
  cameraFor,
  noteFrameTime,
  render,
  renderMenuBackground,
  screenToWorld,
  type Art,
  type Camera,
  type LeaderboardSize,
} from "./render.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("xcanvas");
const ctx = canvas.getContext("2d")!;
const overlay = $("overlay");
const statsPanel = $("statsPanel");
const nickInput = $<HTMLInputElement>("nick");
const statsText = $("stats");
const settingsPanel = $("settingsPanel");
const settingsToggle = $("settingsToggle");
const killConfirmation = $("killConfirmation");
const moreInfoOverlay = $("moreInfoOverlay");
const moreInfoFrame = $<HTMLIFrameElement>("moreInfoFrame");
const topGui = $("topGui");
const topGuiConnecting = $("topGuiConnecting");
const spectatorButton = $<HTMLButtonElement>("spectatorButton");
const shareButton = $("copyLink");
const sharePanel = $("copyLinkBox");
const shareInput = $<HTMLInputElement>("roomlinkInput");
const safariTooltip = $("safariTooltip");
const copiedOverlay = $("overlay2");
const regionBox = $("regionSelectorBox");
const regionToggle = $<HTMLButtonElement>("regionSelectorToggle");
const regionLabel = $("regionSelectorLabel");
const regionHeader = $("regionSelectorHeader");
const regionOptions = $("regionSelectorOptions");

/** The client's own room notices. This port's room answers every time, so they
 * never come up, but their buttons still do what the client's do. */
const ROOM_NOTICES = ["captchaFailed", "roomTimeout", "roomFailed"];

const art: Art = { food: null, boostHint: null, board: null, sheet: null };

type Quality = "high" | "low";
/**
 * How the line is steered. The client's own config carries the same two desktop
 * modes (`INPUT_MOUSE_ONLY` and `INPUT_KEYBOARD_ONLY`); the third is the touch
 * scheme its mobile builds use, which here is the same pointer steering driven by
 * a finger. Mouse is the default on a desktop.
 */
type InputMode = "mouse" | "keys" | "touch";
const KEY_DIRS = ["up", "down", "left", "right"] as const;
type KeyDir = (typeof KEY_DIRS)[number];
type KeyBinds = Record<KeyDir, string>;

/** Ordinary desktop steering: the arrow keys, with WASD always as an alias. */
const DEFAULT_KEYS: KeyBinds = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};
const KEY_ALIASES: KeyBinds = { up: "w", down: "s", left: "a", right: "d" };
const DIR_VECTORS: Record<KeyDir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

interface Settings {
  nick: string;
  quality: Quality;
  sound: boolean;
  shake: boolean;
  killStreaks: boolean;
  names: boolean;
  leaderboard: LeaderboardSize;
  stats: boolean;
  input: InputMode;
  keys: KeyBinds;
}

/**
 * Storage, guarded: a `file://` page may be denied localStorage entirely, and
 * reading it at startup used to blank the page. Defaults are fine.
 */
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // A game that cannot remember your nickname is still a game.
    }
  },
};

/**
 * Reads one of a small set of strings. Storage is shared with every older build
 * of this file, so a value this build no longer knows ("medium" graphics, say)
 * has to fall back rather than leave the settings row with nothing pressed and
 * the game on an unnamed mode.
 */
const read = <T extends string>(key: string, allowed: readonly T[], fallback: T) => {
  const stored = store.get(`pl_${key}`);
  return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
};
const readBool = (key: string, fallback: boolean) => {
  const stored = store.get(`pl_${key}`);
  return stored === null ? fallback : stored === "1";
};

/**
 * Mouse on a desktop, touch where the only pointer is a finger. `(pointer: fine)`
 * also matches a mouse on a hybrid laptop.
 */
function defaultInput(): InputMode {
  if (typeof window.matchMedia === "function") {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (coarse && !fine) return "touch";
  }
  return "mouse";
}

function readKeys(): KeyBinds {
  try {
    const raw = store.get("pl_keys");
    if (!raw) return { ...DEFAULT_KEYS };
    const parsed = JSON.parse(raw) as Partial<KeyBinds>;
    const keys = { ...DEFAULT_KEYS };
    for (const dir of KEY_DIRS) {
      const value = parsed[dir];
      if (typeof value === "string" && value) keys[dir] = value;
    }
    return keys;
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

const settings: Settings = {
  nick: store.get("pl_nick") ?? "",
  quality: read<Quality>("quality", ["high", "low"], "high"),
  sound: readBool("sound", true),
  shake: readBool("shake", true),
  killStreaks: readBool("killstreaks", true),
  names: readBool("names", true),
  leaderboard: read<LeaderboardSize>("leaderboard", ["off", "small", "big"], "big"),
  stats: readBool("stats", true),
  input: read<InputMode>("input", ["mouse", "keys", "touch"], defaultInput()),
  keys: readKeys(),
};

function saveSettings() {
  sound.setEnabled(settings.sound);
  // The death track is an HTMLAudioElement, outside the WebAudio master gain:
  // muting has to stop it as well as turn the cues down.
  if (!settings.sound) stopDeath();
  store.set("pl_nick", settings.nick);
  store.set("pl_quality", settings.quality);
  for (const [key, stored] of [
    ["sound", "sound"],
    ["shake", "shake"],
    ["killStreaks", "killstreaks"],
    ["names", "names"],
    ["stats", "stats"],
  ] as const) {
    store.set(`pl_${stored}`, settings[key] ? "1" : "0");
  }
  store.set("pl_leaderboard", settings.leaderboard);
  store.set("pl_input", settings.input);
  store.set("pl_keys", JSON.stringify(settings.keys));
}

/** A best score that is not a number would be printed straight onto the death
 * card and would never be beaten, so anything unreadable counts as none. */
const readBest = (key: string) => {
  const value = Number(store.get(key) ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
const best = {
  score: readBest("pl_best_score"),
  streak: readBest("pl_best_ks"),
};

let world: World | null = null;
let camera: Camera | null = null;
let playing = false;
/**
 * The player's own snake. While spectating, `world.me` is lent to the followed
 * bot so the camera and the HUD follow it; this is the slot to hand back before
 * joining a run, so the bot is not consumed and the player's slot is reused.
 */
let playerSlot: Snake | null = null;
/** Spectator mode: the client's spectator button, following the leader. */
let spectating = false;
let diedAt = 0;
let deathTrack: HTMLAudioElement | null = null;
let hasBoosted = false;
let shakePower = 0;
/**
 * The rub state last sent to the audio graph. Ramping four parameters every frame
 * churns the audio thread for values that have not moved.
 */
let audioState = { rubbing: false, closeness: 0, pace: 0 };
let fps = 60;
let lastFrame = performance.now();
/** One frame loop at a time: starting a game from the spectator view must not
 * leave the old loop running alongside the new one. */
let looping = false;

/* ------------------------------------------------------------------- art -- */

function loadArt() {
  const pending: Promise<void>[] = [];
  const load = (key: keyof Art, src: string) =>
    new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        art[key] = img;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src;
    });
  pending.push(load("food", "__ASSET_FOOD__"));
  pending.push(load("boostHint", "__ASSET_BOOST_HINT__"));
  // The board is the first tile of the client's own playfield sprite. It is cut
  // out here so the renderer only ever sees the 128×128 piece it repeats.
  pending.push(
    new Promise<void>((resolve) => {
      const sheet = new Image();
      sheet.onload = () => {
        // The renderer cuts the client's in-game sprites (head, glow, food,
        // crown, kill-streak skull) out of this same sheet, so it keeps it.
        art.sheet = sheet;
        const tile = document.createElement("canvas");
        tile.width = 128;
        tile.height = 128;
        tile.getContext("2d")!.drawImage(sheet, 2, 2, 128, 128, 0, 0, 128, 128);
        art.board = tile;
        resolve();
      };
      sheet.onerror = () => resolve();
      sheet.src = "__ASSET_SHEET__";
    }),
  );
  return Promise.all(pending);
}

/* ----------------------------------------------------------------- sound -- */

/**
 * The one sound the client actually ships: out.ogg, played when you die. It is
 * an 18-second track, not a loop, and dying again has to start it again — the
 * old element resumed at its ended position, so only the first death of a
 * session had music. It is also stopped when the death screen closes, rather
 * than playing on under the next run.
 */
function deathAudio() {
  if (!deathTrack) {
    deathTrack = new Audio("__ASSET_SOUND__");
    deathTrack.preload = "auto";
    deathTrack.volume = 0.5;
  }
  return deathTrack;
}

function playDeath() {
  if (!settings.sound) return;
  const track = deathAudio();
  track.currentTime = 0;
  void track.play().catch(() => {});
}

function stopDeath() {
  if (!deathTrack) return;
  deathTrack.pause();
  deathTrack.currentTime = 0;
}

/* -------------------------------------------------------------- the menu -- */

const basePanel = $("basePanel");
const mainDialog = $("mainDialog");
const mainLogo = $<HTMLImageElement>("mainLogo");

/**
 * The client fits its menu to the window: it scales the dialog by height/900 (to
 * a maximum of 1) around its top centre, drops it a little further down once the
 * window is taller than the 900 it was laid out for, and fits the logo to the
 * window width. Measured off the client at nine viewport sizes; the scale matches
 * it exactly, the vertical offset within 10px.
 */
/**
 * The menu's fit. The client scales its 510px panel by height/900. That is enough
 * on a desktop, but the port asks for the device's real width, so on a 390px
 * phone the panel was 478px wide and hung 44px off each side — the nickname row
 * and the Enter hint were cut off. The width fits it too.
 */
function menuScale() {
  return Math.min(1, window.innerHeight / 900, (window.innerWidth - 12) / 510);
}

function layoutMenu() {
  const height = window.innerHeight;
  const scale = menuScale();
  mainDialog.style.transformOrigin = "center top";
  // This transform is also the death panel's containing block, and the client's
  // panel is scaled by both: measured live at 1280×800, its 980px layout width
  // renders 490px wide because 0.8889 (the dialog) × 0.5625 (the panel) compounds.
  mainDialog.style.transform = `translate(-50%, 0%) scale(${scale})`;
  mainDialog.style.top = `${Math.max(0, (height - 900) / 2) + 282.8 * scale}px`;
  mainLogo.style.maxWidth = `${Math.max(200, window.innerWidth - 40)}px`;
  mainLogo.style.height = "auto";
}

/**
 * The overlay holds the menu, the nickname panel and the death screen together,
 * so leaving the menu hides only the nickname panel — the death panel is a
 * sibling of it and has to be able to come up over the running game.
 */
function setMenuVisible(visible: boolean) {
  // The real page nests every panel inside #overlay, so hiding it hides the lot:
  // the dialog, the gear, the region picker and the store badges.
  overlay.style.display = visible ? "block" : "none";
  basePanel.style.display = visible ? "" : "none";
  statsPanel.style.display = "none";
  // The logo lives beside the death panel inside #mainDialog, not inside the
  // nickname panel, so hiding the menu does not hide it. Left alone it hangs
  // above a death screen that has no logo in it.
  mainLogo.style.display = visible ? "" : "none";
  overlay.classList.remove("death-screen-active");
  canvas.style.cursor = visible ? "default" : "none";
  closeSettings();
  setShareOpen(false);
  setRegionOpen(false);
  // With the death panel hidden again, the dialog can take its menu transform
  // (and its vertical fit) back.
  layoutMenu();
  if (visible && online) nickInput.focus();
}

// The client keeps its panels out of the layout with the hidden attribute while
// they are closed, and slides them in with the class once shown.
function openSettings() {
  settingsPanel.hidden = false;
  void settingsPanel.offsetWidth;
  settingsPanel.classList.add("is-open");
  settingsPanel.setAttribute("aria-hidden", "false");
  settingsPanel.removeAttribute("inert");
  settingsToggle.setAttribute("aria-expanded", "true");
}

function closeSettings() {
  settingsPanel.classList.remove("is-open");
  settingsPanel.hidden = true;
  settingsPanel.setAttribute("aria-hidden", "true");
  settingsPanel.setAttribute("inert", "");
  settingsToggle.setAttribute("aria-expanded", "false");
}

/**
 * The client's connection state. Its markup ships mid-connection: "Connecting..."
 * where the nickname row goes, the row itself behind `hidden`, the spectator
 * button `disabled`, the Play With Friends button `display:none`, and the region
 * picker disabled. Its script swaps that state in when the room answers. The room
 * here is the page itself, so this runs once the art the game draws with is in
 * hand.
 */
let online = false;

function goOnline() {
  if (online) return;
  online = true;
  topGuiConnecting.hidden = true;
  topGui.hidden = false;
  spectatorButton.disabled = false;
  regionToggle.disabled = false;
  shareButton.style.display = "";
  shareInput.value = roomLink();
  // The live page labels itself "Auto Region | North America"; the picker's own
  // stylesheet draws the divider, and its data attributes position the label.
  regionBox.dataset.automatic = "true";
  regionBox.dataset.selectedRegion = "North America";
  regionLabel.innerHTML =
    '<span class="region-selector-auto-label">Auto Region</span>' +
    '<span class="region-selector-server-label">North America</span>';
  buildRegions();
  if (!playing) nickInput.focus();
}

/** What the client's Play With Friends panel copies: the address of this game. */
function roomLink() {
  return location.href;
}

/* ------------------------------------------------------------ the regions -- */

/**
 * The region picker. On the live site it lists the rooms its server list reports,
 * with their player counts and a ping that starts at "—" and resolves once the
 * game is running. There is one room here — this page — so the same five rows are
 * listed with it as the only reachable one, in the client's own markup: the
 * automatic row, then the four regions, each with its count and ping cell.
 */
const REGIONS = ["North America", "Europe", "South America", "Asia"] as const;

function selectRegion(name: string, automatic: boolean) {
  for (const option of regionOptions.querySelectorAll<HTMLElement>(".region-selector-option")) {
    option.setAttribute("aria-selected", String(option.dataset.regionAutomatic === "true" ? automatic : !automatic && option.dataset.regionName === name));
  }
  regionBox.dataset.automatic = String(automatic);
  regionBox.dataset.selectedRegion = name;
  regionLabel.innerHTML = automatic
    ? '<span class="region-selector-auto-label">Auto Region</span>' +
      `<span class="region-selector-server-label">${name}</span>`
    : `<span class="region-selector-server-label">${name}</span>`;
  setRegionOpen(false);
}

function buildRegions() {
  const automatic = document.createElement("button");
  automatic.type = "button";
  automatic.className = "region-selector-option region-selector-option-automatic";
  automatic.dataset.regionAutomatic = "true";
  automatic.setAttribute("role", "option");
  automatic.setAttribute("aria-selected", "true");
  automatic.setAttribute("aria-label", "Automatic, North America, 14 players, latency not measured");
  automatic.innerHTML =
    '<span class="region-option-radio" aria-hidden="true"></span>' +
    '<span class="region-option-name">Automatic (North America)</span>';
  automatic.addEventListener("click", () => selectRegion("North America", true));

  // The local room is the one that answers; the rest are listed but unreachable,
  // which is exactly the state the live picker shows for a region it cannot reach.
  const rows = REGIONS.map((name) => {
    const local = name === "North America";
    const players = local ? 14 : 0;
    const option = document.createElement("button");
    option.type = "button";
    option.className = "region-selector-option";
    option.dataset.regionName = name;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    option.setAttribute(
      "aria-label",
      `${name}, ${players} players, ${local ? "live gameplay ping pending" : "server unreachable"}`,
    );
    option.innerHTML =
      '<span class="region-option-radio" aria-hidden="true"></span>' +
      `<span class="region-option-name">${name}</span>` +
      `<span class="region-option-players">${players} players</span>` +
      `<span class="region-option-ping" data-latency-status="${local ? "live-pending" : "unreachable"}" title="${local ? "live gameplay ping pending" : "server unreachable"}">—</span>`;
    option.addEventListener("click", () => selectRegion(name, false));
    return option;
  });

  regionOptions.replaceChildren(automatic, ...rows);
  regionBox.style.setProperty("--region-option-count", String(1 + rows.length));
}

function setRegionOpen(open: boolean) {
  regionBox.classList.toggle("is-open", open);
  regionToggle.setAttribute("aria-expanded", String(open));
  regionHeader.setAttribute("aria-hidden", String(!open));
  regionOptions.hidden = !open;
  if (open) regionHeader.removeAttribute("inert");
  else regionHeader.setAttribute("inert", "");
}

/* --------------------------------------------------------------- the link -- */

function setShareOpen(open: boolean) {
  sharePanel.classList.toggle("is-open", open);
  sharePanel.setAttribute("aria-hidden", String(!open));
  shareButton.setAttribute("aria-expanded", String(open));
  if (open) {
    sharePanel.removeAttribute("inert");
    shareInput.value = roomLink();
  } else {
    sharePanel.setAttribute("inert", "");
  }
}

/**
 * The client's COPY button: the link goes on the clipboard and its own
 * "LINK COPIED!" overlay drops over the board for a moment. Where the clipboard is
 * refused — Safari, outside a gesture — it shows the ⌘+C tooltip it ships.
 */
async function copyRoomLink() {
  const link = shareInput.value || roomLink();
  try {
    await navigator.clipboard.writeText(link);
    copiedOverlay.hidden = false;
    window.setTimeout(() => {
      copiedOverlay.hidden = true;
    }, 1200);
  } catch {
    shareInput.select();
    safariTooltip.hidden = false;
    window.setTimeout(() => {
      safariTooltip.hidden = true;
    }, 1600);
  }
}

/* ------------------------------------------------------------ the notices -- */

function clearRoomNotices() {
  for (const id of ROOM_NOTICES) $(id).hidden = true;
}

/** The client's TRY AGAIN and RECONNECT buttons: connect again. */
function reconnect() {
  clearRoomNotices();
  online = false;
  topGui.hidden = true;
  topGuiConnecting.hidden = false;
  window.setTimeout(goOnline, 400);
}

/** The client's CONTINUE button: back to the menu, its own state restored. */
function continueToMenu() {
  clearRoomNotices();
  setMenuVisible(true);
}

function paintSettings() {
  ($("settingsShake") as HTMLInputElement).checked = settings.shake;
  ($("settingsKillStreaks") as HTMLInputElement).checked = settings.killStreaks;
  ($("settingsShowNames") as HTMLInputElement).checked = settings.names;
  ($("settingsSound") as HTMLInputElement).checked = settings.sound;
  ($("settingsStats") as HTMLInputElement).checked = settings.stats;
  $("settingsGraphicsLow").setAttribute("aria-pressed", String(settings.quality === "low"));
  $("settingsGraphicsHigh").setAttribute("aria-pressed", String(settings.quality === "high"));
  $("settingsLeaderboardOff").setAttribute("aria-pressed", String(settings.leaderboard === "off"));
  $("settingsLeaderboardSmall").setAttribute("aria-pressed", String(settings.leaderboard === "small"));
  $("settingsLeaderboardBig").setAttribute("aria-pressed", String(settings.leaderboard === "big"));

  // The controls rows this port adds to the client's list. They are optional
  // here because paintSettings also runs on the menu before buildControls.
  for (const [id, mode] of [
    ["settingsControlsMouse", "mouse"],
    ["settingsControlsKeys", "keys"],
    ["settingsControlsTouch", "touch"],
  ] as const) {
    document.getElementById(id)?.setAttribute("aria-pressed", String(settings.input === mode));
  }
  for (const dir of KEY_DIRS) {
    settingsPanel.querySelector<HTMLElement>(`.settings-keybind-row[data-dir="${dir}"]`)?.toggleAttribute("hidden", settings.input !== "keys");
    const button = settingsPanel.querySelector<HTMLButtonElement>(`.settings-keybind[data-dir="${dir}"]`);
    if (!button) continue;
    button.classList.toggle("is-listening", capturingKey === dir);
    button.textContent = capturingKey === dir ? "PRESS KEY" : keyLabel(settings.keys[dir]);
    button.title =
      capturingKey === dir
        ? "Press a key, or Escape to cancel"
        : `${settings.keys[dir]} — ${KEY_ALIASES[dir].toUpperCase()} works too`;
  }

  // The panel's stylesheet drops the bottom rule from its last row. The port's
  // rows can be hidden, so the row that *is* last on screen is marked here.
  const rows = [...settingsPanel.querySelectorAll<HTMLElement>(".settings-list .settings-row")].filter(
    (row) => !row.hidden,
  );
  for (const row of rows) row.classList.toggle("is-last", row === rows[rows.length - 1]);
}

/* ------------------------------------------------------------- controls -- */

/**
 * The steering keys currently down, and the direction pressed last (it wins).
 * The keys are kept by name, not by direction, so holding Up and W together and
 * letting go of one still leaves the line pointing up.
 */
const heldKeys = new Set<string>();
let lastKeyDir: KeyDir | null = null;
/** The direction waiting for a new key, while its chip says PRESS KEY. */
let capturingKey: KeyDir | null = null;

/** A key's chip label: arrows as arrows, letters upper-case, space spelled out. */
function keyLabel(key: string) {
  const known: Record<string, string> = {
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    " ": "SPACE",
    space: "SPACE",
    escape: "ESC",
    control: "CTRL",
    shift: "SHIFT",
  };
  return known[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** The direction a key steers, or null when it steers nothing. */
function dirForKey(key: string): KeyDir | null {
  const lower = key.toLowerCase();
  // A direction's own binding beats another direction's WASD alias, so a player
  // who binds Up to S still gets Up from it.
  for (const dir of KEY_DIRS) if (settings.keys[dir].toLowerCase() === lower) return dir;
  for (const dir of KEY_DIRS) if (KEY_ALIASES[dir] === lower) return dir;
  return null;
}

/**
 * The controls rows, built into the client's own `.settings-list` so the panel's
 * stylesheet dresses them exactly like its rows: a segmented Mouse / Keys / Touch
 * choice, and one rebindable chip per direction (shown only in Keys mode).
 */
function buildControls() {
  const list = settingsPanel.querySelector(".settings-list");
  if (!list || document.getElementById("settingsControlsMouse")) return;

  const row = document.createElement("div");
  row.className = "settings-row";
  row.innerHTML =
    '<span class="settings-label">Controls</span>' +
    '<div class="settings-segmented" role="group" aria-label="Controls">' +
    '<button id="settingsControlsMouse" type="button" aria-pressed="false">Mouse</button>' +
    '<button id="settingsControlsKeys" type="button" aria-pressed="false">Keys</button>' +
    '<button id="settingsControlsTouch" type="button" aria-pressed="false">Touch</button>' +
    '</div>';
  list.append(row);

  for (const dir of KEY_DIRS) {
    const bindRow = document.createElement("div");
    bindRow.className = "settings-row settings-keybind-row";
    bindRow.dataset.dir = dir;
    bindRow.hidden = true;
    bindRow.innerHTML =
      `<span class="settings-label">${dir[0]!.toUpperCase()}${dir.slice(1)}</span>` +
      `<button class="settings-keybind" type="button" data-dir="${dir}" aria-label="Rebind ${dir}"></button>`;
    list.append(bindRow);
    bindRow.querySelector("button")!.addEventListener("click", () => {
      capturingKey = dir;
      paintSettings();
    });
  }

  for (const [id, mode] of [
    ["settingsControlsMouse", "mouse"],
    ["settingsControlsKeys", "keys"],
    ["settingsControlsTouch", "touch"],
  ] as const) {
    $(id).addEventListener("click", () => {
      settings.input = mode;
      capturingKey = null;
      clearKeys();
      saveSettings();
      paintSettings();
    });
  }
}

function clearKeys() {
  heldKeys.clear();
  lastKeyDir = null;
}

/**
 * Keyboard steering: a held direction points the line far down that lane, and
 * with nothing held it keeps pointing down the lane it is already on, so the
 * snake runs straight instead of hunting a stale target.
 */
function aimWithKeys(me: Snake) {
  if (!world) return;
  const vector = lastKeyDir ? DIR_VECTORS[lastKeyDir] : laneVector(me.dir);
  world.input = { x: me.head.x + vector.x * 1000, y: me.head.y + vector.y * 1000 };
}

function laneVector(dir: Dir) {
  if (dir === DIR.UP) return DIR_VECTORS.up;
  if (dir === DIR.DOWN) return DIR_VECTORS.down;
  if (dir === DIR.LEFT) return DIR_VECTORS.left;
  return DIR_VECTORS.right;
}

/* ---------------------------------------------------------------- gameplay -- */

/**
 * The arena the menu stands on. The live page joins a room before it asks for a
 * nickname, so its join screen sits over a room that is already playing; the port
 * keeps the same one world for the menu and the run, with no player in it until
 * you join.
 */
function makeMenuWorld() {
  const menu = new World("Spectator", Math.random() * 360);
  menu.me.alive = false;
  menu.me.diedAt = 0;
  return menu;
}

function startGame() {
  // Enter in the nickname box runs the markup's own `clickPlay`, which also lands
  // here through the window's key handler; the first one wins. From the spectator
  // view Enter starts a real run, so it is allowed through. The client's nickname
  // row is disabled until the room answers.
  if (playing && !spectating) return;
  if (!online) return;
  const nick = (nickInput.value.trim() || settings.nick || "You").slice(0, 15);
  settings.nick = nick;
  nickInput.value = nick;
  saveSettings();

  // Spectating lent the player's role to a bot; take the slot back before
  // joining, so the bot stays a bot and the player keeps their own slot.
  if (world && playerSlot) world.me = playerSlot;
  playerSlot = null;
  world ??= makeMenuWorld();
  if (!world.me.alive) world.joinMe(nick, Math.random() * 360);

  playing = true;
  spectating = false;
  diedAt = 0;
  hasBoosted = false;
  clearKeys();
  if (settings.input !== "keys" && pointerAt) cursor = pointerAt;
  stopDeath();
  camera = cameraFor(world, window.innerWidth, window.innerHeight);
  setMenuVisible(false);
  lastFrame = performance.now();
  startLoop();
}

function exitToMenu() {
  playing = false;
  spectating = false;
  clearKeys();
  // The player leaves the room the way a live client does: the room keeps
  // playing, so the menu behind the dialog is a real arena. The empty slot is
  // reused the next time Play is pressed.
  if (world) {
    if (playerSlot) world.me = playerSlot;
    world.me.alive = false;
    world.me.rubPartner = null;
  }
  playerSlot = null;
  sound.setBoost(false);
  audioState = { rubbing: false, closeness: 0, pace: 0 };
  shakePower = 0;
  stopDeath();
  setMenuVisible(true);
}

/**
 * Spectator mode, added to the client in August 2026. There is no server to watch
 * here, so the port follows the leading snake: the followed snake becomes the
 * world's player, which puts the camera and the HUD on it while its own AI keeps
 * steering it.
 */
function startSpectate() {
  if (playing || !online) return;
  const nick = (nickInput.value.trim() || settings.nick || "You").slice(0, 15);
  settings.nick = nick;
  nickInput.value = nick;
  saveSettings();

  world ??= makeMenuWorld();
  playerSlot = world.me;
  playerSlot.alive = false;
  followLeader();
  playing = true;
  spectating = true;
  diedAt = 0;
  hasBoosted = true;
  stopDeath();
  camera = cameraFor(world, window.innerWidth, window.innerHeight);
  setMenuVisible(false);
  lastFrame = performance.now();
  startLoop();
}

function followLeader() {
  if (!world) return;
  const leader = world.leaderboard()[0];
  if (leader) world.me = leader;
}

let cursor: { x: number; y: number } | null = null;

function startLoop() {
  if (looping) return;
  looping = true;
  lastFrame = performance.now();
  requestAnimationFrame(loop);
}

/**
 * One frame of the menu. The room behind it is real and keeps running, so the run
 * you join is the room you were standing over — but the client draws none of it:
 * its join screen stands on the bare board, with no pellets, snakes or particles
 * showing through. This is exactly that frame.
 */
function drawMenuFrame(dt: number) {
  const menu = (world ??= makeMenuWorld());
  menu.step(dt);
  menu.drainEvents();
  menu.updateParticles(dt);
  renderMenuBackground(ctx, art, settings.quality);
}

function loop(now: number) {
  const dt = now - lastFrame;
  lastFrame = now;
  fps = fps * 0.9 + (1000 / Math.max(dt, 1)) * 0.1;
  noteFrameTime(dt);

  if (!playing) {
    drawMenuFrame(Math.min(dt, 300));
    requestAnimationFrame(loop);
    return;
  }
  if (!world) {
    requestAnimationFrame(loop);
    return;
  }

  let me = world.me;
  shakePower = Math.max(0, shakePower - dt / 320);

  if (spectating) {
    world.step(dt);
    world.drainEvents();
    // Particles run on the display's clock, not the 10Hz tick, so they stay smooth.
    world.updateParticles(dt);
    if (!me.alive) {
      followLeader();
      me = world.me;
      camera = cameraFor(world, window.innerWidth, window.innerHeight);
    }
    refreshStats();
    // The camera follows the interpolated head, so it is read after the step.
    camera = cameraFor(world, window.innerWidth, window.innerHeight);
    render(ctx, world, camera, art, {
      quality: settings.quality,
      timeAlive: Math.max(0, (me.alive ? world.time : me.diedAt) - me.spawnedAt) / 1000,
      names: settings.names,
      killStreaks: settings.killStreaks,
      leaderboard: settings.leaderboard,
      shake: 0,
      cursor,
      now,
      showBoostHint: false,
    });
    requestAnimationFrame(loop);
    return;
  }

  if (!me.alive) {
    world.step(dt);
    world.drainEvents();
    if (diedAt === 0) {
      diedAt = now;
      showDeath(me);
    }
    // The board keeps drawing under the death panel, so the corner counter has
    // to keep counting; it used to freeze on the value it had when you died.
    refreshStats();
  } else {
    if (settings.input === "keys") {
      aimWithKeys(me);
    } else if (cursor && camera) {
      const target = screenToWorld(camera, canvas, cursor.x, cursor.y);
      if (Math.hypot(target.x - me.head.x, target.y - me.head.y) > 2.4) world.input = target;
    }
    world.step(dt);
    for (const event of world.drainEvents()) handleEvent(event);
    // The hum is the client's `lineLoopSound`, which belongs to riding alongside
    // another line, not to a key press: it starts with the rub and fades when the
    // two heads part. The crackle rides the same state.
    const rubbing = me.rubPartner !== null;
    const closeness = rubbing ? me.rubCloseness : 0;
    const pace = Math.min(1, me.extraSpeed / CONFIG.maxRubSpeed);
    if (
      rubbing !== audioState.rubbing ||
      Math.abs(closeness - audioState.closeness) > 0.03 ||
      Math.abs(pace - audioState.pace) > 0.03
    ) {
      sound.setBoost(rubbing, closeness, pace);
      audioState = { rubbing, closeness, pace };
    }
    sound.rubbing(closeness, pace);
    if (me.boosting) hasBoosted = true;
    refreshStats();
  }

  world.updateParticles(dt);
  camera = cameraFor(world, window.innerWidth, window.innerHeight);

  render(ctx, world, camera, art, {
    quality: settings.quality,
    timeAlive: Math.max(0, ((me.alive ? world.time : me.diedAt) - me.spawnedAt) / 1000),
    names: settings.names,
    killStreaks: settings.killStreaks,
    leaderboard: settings.leaderboard,
    shake: settings.shake ? shakePower : 0,
    cursor,
    now,
    showBoostHint: !hasBoosted && me.alive && me.score < 40,
  });
  requestAnimationFrame(loop);
}

function handleEvent(event: { type: string; [key: string]: unknown }) {
  if (event.type === "wasKilled") {
    sound.setBoost(false);
    sound.crash();
    playDeath();
    // Dying does not punch the camera. It used to, and because the board was
    // painted before the shake offset the whole arena rattled against a still
    // background for a third of a second while the death panel faded in.
    shakePower = 0;
    return;
  }
  if (event.type === "kill") {
    shakePower = 1;
    showKillConfirmation(String(event.victim), event.king === true);
  }
}

function refreshStats() {
  if (!world) return;
  const me = world.me;
  statsText.textContent = settings.stats ? `FPS ${Math.round(fps)}` : "";
  if (spectating) return;
  if (me.score > best.score) {
    best.score = me.score;
    store.set("pl_best_score", String(best.score));
  }
  if (me.killstreak > best.streak) {
    best.streak = me.killstreak;
    store.set("pl_best_ks", String(best.streak));
  }
}

function showKillConfirmation(victim: string, isKing: boolean) {
  ($("killConfirmationName")).textContent = victim;
  fitKillConfirmation();
  killConfirmation.classList.toggle("is-king-kill", isKing);
  killConfirmation.hidden = false;
  killConfirmation.classList.remove("is-hiding");
  void killConfirmation.offsetWidth;
  killConfirmation.classList.add("is-visible");
  window.setTimeout(() => {
    killConfirmation.classList.add("is-hiding");
    killConfirmation.classList.remove("is-visible");
    window.setTimeout(() => {
      killConfirmation.hidden = true;
      killConfirmation.classList.remove("is-hiding");
    }, 420);
  }, 1700);
}

function showDeath(me: Snake) {
  // Two headings, exactly as the client's stylesheet defines them. A death at
  // another snake's hands is the small "KILLED BY" over the killer's nickname.
  // The wall and your own trail have nobody to name, so they use the panel's
  // `is-collision` variant: one large centered "COLLIDED" with no killer line
  // underneath. That variant — bigger cause, hidden name — is the client's own;
  // the port was writing "KILLED BY <Unnamed>" into it and never applying it.
  const collided = !me.killer;
  $("stat-cause").textContent = collided ? "COLLIDED" : "KILLED BY";
  // The nickname is shown as it is written in the game; the client's stylesheet
  // does not uppercase it.
  $("stat-title").textContent = me.killer;
  $("stat-length").textContent = String(me.score);
  $("stat-blength").textContent = String(best.score);
  $("stat-ks").textContent = String(me.killstreak);
  $("stat-bks").textContent = String(best.streak);
  $("stat-top").textContent = String(me.topPosition || "-");
  $("stat-time").textContent = `${Math.round((me.diedAt - me.spawnedAt) / 1000)}s`;

  // A kill confirmation from the last second sits above the death panel
  // (z-index 21 over 20), so a kill followed by a death used to show "YOU KILLED"
  // over your own "KILLED BY" heading.
  killConfirmation.hidden = true;
  killConfirmation.classList.remove("is-visible", "is-hiding");

  overlay.style.display = "block";
  // The panel is a stack — heading, stat grid, divider, buttons — and its own
  // stylesheet lays it out as one. `display:flex` turned it into a row that put
  // the heading, all six cards, the divider and both buttons side by side.
  statsPanel.style.display = "";
  layoutMenu();
  statsPanel.classList.toggle("is-collision", collided);
  statsPanel.classList.add("is-intro");
  statsPanel.setAttribute("aria-hidden", "false");
  statsPanel.removeAttribute("inert");
  overlay.classList.add("death-screen-active");
  mainLogo.style.display = "none";
  // The pointer is hidden over the canvas while playing; the death screen has
  // buttons to click.
  canvas.style.cursor = "default";
  fitDeathPanel();
  window.setTimeout(() => statsPanel.classList.remove("is-intro"), 140);
}

/**
 * The client's own panel scale, read off the live page: `--death-screen-scale`
 * follows viewport height / 1600, clamped to [0.5625, 0.75] — 0.5625 at 1280×800,
 * 0.625 at 1000, 0.675 at 1080, 0.75 from 1200 up. The stylesheet's 0.75 fallback
 * is the panel's maximum, not what any normal desktop sees, so the port was
 * drawing the death screen a third too large.
 */
function fitDeathPanel() {
  const dialog = menuScale();
  // Phones and short windows: the panel is a descendant of the dialog, so its
  // own scale compounds with the menu's and leaves a card stack too small to
  // read — 153px wide on a 390px screen. There it is drawn at the size its narrow
  // stylesheet was written for (the dialog's scale undone), and shrunk further
  // only if the screen cannot hold its height. Desktop keeps the client's
  // measured height/1600 rule exactly.
  const fitToScreen = window.innerWidth <= 700 || window.innerHeight <= 700;
  if (!fitToScreen) {
    statsPanel.style.top = "";
    statsPanel.style.setProperty("--death-screen-scale", Math.min(0.75, Math.max(0.5625, window.innerHeight / 1600)).toFixed(4));
    return;
  }
  statsPanel.style.top = "0px";
  statsPanel.style.setProperty("--death-screen-scale", (1 / dialog).toFixed(4));
  const natural = statsPanel.getBoundingClientRect();
  if (natural.height > window.innerHeight - 32 && natural.height > 0) {
    const fit = (window.innerHeight - 32) / natural.height;
    statsPanel.style.setProperty("--death-screen-scale", (fit / dialog).toFixed(4));
  }
  // Its CSS top is a fraction of the small dialog it hangs in, which would pull
  // it off the top of the screen at full size. A change of `top` moves the drawn
  // box by `top * dialog`, because the dialog's transform scales it.
  const top = statsPanel.getBoundingClientRect().top;
  statsPanel.style.top = `${Math.round((16 - top) / dialog)}px`;
}

/**
 * The kill confirmation's scale follows the same height / 1600 rule but has no
 * 0.5625 floor (measured 0.4375 at 700px, 0.5 at 800, 0.5625 at 900, 0.625 at
 * 1000, 0.75 from 1200). The stylesheet's fallback is again its maximum.
 */
function fitKillConfirmation() {
  killConfirmation.style.setProperty(
    "--kill-confirmation-scale",
    Math.min(0.75, Math.max(0.4375, window.innerHeight / 1600)).toFixed(4),
  );
}

function respawn() {
  if (!world) {
    startGame();
    return;
  }
  stopDeath();
  shakePower = 0;
  world.respawnMe(settings.nick || "You", Math.random() * 360);
  diedAt = 0;
  overlay.style.display = "none";
  statsPanel.style.display = "none";
  statsPanel.setAttribute("aria-hidden", "true");
  statsPanel.setAttribute("inert", "");
  overlay.classList.remove("death-screen-active");
  canvas.style.cursor = "none";
  // Restores the menu dialog's transform that the death screen dropped.
  layoutMenu();
  lastFrame = performance.now();
}

/* ------------------------------------------------------------------ inputs -- */

nickInput.value = settings.nick;
// A run started with the sound switch already off must stay silent: the cues are
// gated on the engine's own flag, which starts true.
sound.setEnabled(settings.sound);

// A browser only lets an AudioContext start inside a user gesture. The first one
// anywhere on the page is enough, and the cues before it (nothing plays at the
// menu) are simply dropped.
for (const type of ["pointerdown", "keydown"] as const) {
  window.addEventListener(
    type,
    () => {
      sound.unlock();
      // The client preloads its death track at the menu; doing it on the first
      // gesture means the first death is not waiting on an 18-second decode.
      deathAudio().load();
    },
    { once: true, capture: true },
  );
}

// The hum is tied to the live speed state, but a tab that is hidden stops
// animating, so the last frame's hum would drone on in the background.
function silenceHum() {
  sound.setBoost(false);
}
window.addEventListener("blur", silenceHum);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) silenceHum();
});

// Where the pointer last was. It is tracked at the menu too, so a run starts
// steering from the cursor's real position instead of keeping the join target
// until the mouse is first moved.
let pointerAt: { x: number; y: number } | null = null;
window.addEventListener("mousemove", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointerAt = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  if (playing && settings.input !== "keys") cursor = pointerAt;
});

// Touch steering reads the finger in the canvas' own pixels, so the same client
// point that works on a desktop also works on a phone with page chrome. The page
// must not scroll or zoom under the drag, so the listeners cannot be passive.
function steerToTouch(event: TouchEvent) {
  if (!playing || settings.input === "keys") return;
  const touch = event.touches[0];
  if (!touch) return;
  const rect = canvas.getBoundingClientRect();
  cursor = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  event.preventDefault();
}
canvas.addEventListener("touchstart", steerToTouch, { passive: false });
canvas.addEventListener("touchmove", steerToTouch, { passive: false });

/**
 * Picking a new key for a direction. It runs on the capture phase so the press
 * that becomes a binding cannot also steer, toggle graphics or reach the page.
 */
window.addEventListener(
  "keydown",
  (event) => {
    if (!capturingKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      capturingKey = null;
      paintSettings();
      return;
    }
    // A modifier on its own is not a binding; the player is still reaching.
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(event.key)) return;
    const dir = capturingKey;
    const value = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    // Two directions cannot share a key: the other one takes this bind's old key.
    for (const other of KEY_DIRS) {
      if (other !== dir && settings.keys[other].toLowerCase() === value.toLowerCase()) settings.keys[other] = settings.keys[dir];
    }
    settings.keys[dir] = value;
    capturingKey = null;
    saveSettings();
    paintSettings();
  },
  true,
);

window.addEventListener("keyup", (event) => {
  heldKeys.delete(event.key);
  const dir = dirForKey(event.key);
  if (!dir || lastKeyDir !== dir) return;
  // Fall back to the most recently pressed key still down, if any.
  const stillHeld = [...heldKeys].map(dirForKey).filter((other): other is KeyDir => other !== null);
  lastKeyDir = stillHeld[stillHeld.length - 1] ?? null;
});

window.addEventListener("blur", clearKeys);

window.addEventListener("keydown", (event) => {
  // The About dialog's own inline script claims Escape while it is open.
  if (event.defaultPrevented) return;
  // Typing a nickname must not steer, mute the game or leave the room.
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
  if (capturingKey) return;

  if (settings.input === "keys") {
    const dir = dirForKey(event.key);
    if (dir) {
      // A held arrow must not scroll the page under the arena.
      event.preventDefault();
      if (!event.repeat) {
        heldKeys.add(event.key);
        lastKeyDir = dir;
      }
      return;
    }
  }

  if (event.key === "Enter") {
    if (!playing || spectating) startGame();
    else if (statsPanel.style.display !== "none") respawn();
    return;
  }
  if (event.key === "Escape") {
    if (!moreInfoOverlay.hidden) return;
    if (regionBox.classList.contains("is-open")) {
      setRegionOpen(false);
      return;
    }
    if (sharePanel.classList.contains("is-open")) {
      setShareOpen(false);
      return;
    }
    if (settingsPanel.classList.contains("is-open")) {
      closeSettings();
      return;
    }
    if (playing) exitToMenu();
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "g") cycleGraphics();
  if (key === "m") cycleSound();
  if (key === "i") cycleStats();
  if (key === "l") cycleLeaderboard();
});

function cycleGraphics() {
  settings.quality = settings.quality === "high" ? "low" : "high";
  saveSettings();
  paintSettings();
}

function cycleSound() {
  settings.sound = !settings.sound;
  saveSettings();
  paintSettings();
}

function cycleStats() {
  settings.stats = !settings.stats;
  saveSettings();
  paintSettings();
  if (!settings.stats) statsText.textContent = "";
}

function cycleLeaderboard() {
  settings.leaderboard = settings.leaderboard === "big" ? "small" : settings.leaderboard === "small" ? "off" : "big";
  saveSettings();
  paintSettings();
}

/* -------------------------------------------------------------- the chrome -- */

settingsToggle.addEventListener("click", (event) => {
  event.preventDefault();
  if (settingsPanel.classList.contains("is-open")) closeSettings();
  else openSettings();
});
$("settingsClose").addEventListener("click", () => closeSettings());

for (const [id, apply] of [
  ["settingsShake", (on: boolean) => { settings.shake = on; }],
  ["settingsKillStreaks", (on: boolean) => { settings.killStreaks = on; }],
  ["settingsShowNames", (on: boolean) => { settings.names = on; }],
  ["settingsSound", (on: boolean) => { settings.sound = on; }],
  ["settingsStats", (on: boolean) => { settings.stats = on; if (!on) statsText.textContent = ""; }],
] as const) {
  ($(id) as HTMLInputElement).addEventListener("change", (event) => {
    apply((event.target as HTMLInputElement).checked);
    saveSettings();
  });
}

$("settingsGraphicsLow").addEventListener("click", () => { settings.quality = "low"; saveSettings(); paintSettings(); });
$("settingsGraphicsHigh").addEventListener("click", () => { settings.quality = "high"; saveSettings(); paintSettings(); });
for (const [id, size] of [
  ["settingsLeaderboardOff", "off"],
  ["settingsLeaderboardSmall", "small"],
  ["settingsLeaderboardBig", "big"],
] as const) {
  $(id).addEventListener("click", () => { settings.leaderboard = size; saveSettings(); paintSettings(); });
}

// The spectator and COPY buttons carry the client's own inline handlers, which
// call the names published at the bottom of this file — so they are not bound
// again here.
$("deathPlayAgain").addEventListener("click", () => respawn());
$("deathExit").addEventListener("click", () => exitToMenu());

shareButton.addEventListener("click", () => {
  setShareOpen(!sharePanel.classList.contains("is-open"));
});
$("shareClose").addEventListener("click", () => setShareOpen(false));
regionToggle.addEventListener("click", () => setRegionOpen(!regionBox.classList.contains("is-open")));
$("regionSelectorHeaderToggle").addEventListener("click", () => setRegionOpen(false));
$("regionSelectorClose").addEventListener("click", () => setRegionOpen(false));

// The dialog's own opening, closing, focus handling, click-outside and Escape are
// the client's inline script, injected above the bundle. The port only has to hand
// its frame the page the site would have fetched.
$("moreInfoTrigger").addEventListener("click", () => {
  const frame = moreInfoFrame;
  if (!frame.getAttribute("srcdoc")) frame.setAttribute("srcdoc", $<HTMLTemplateElement>("moreInfoSource").innerHTML);
});

window.addEventListener("resize", () => {
  layoutMenu();
  if (statsPanel.style.display !== "none") fitDeathPanel();
  fitKillConfirmation();
  if (world && playing) camera = cameraFor(world, window.innerWidth, window.innerHeight);
});

/* -------------------------------------------------------------------- boot -- */

buildControls();
paintSettings();
layoutMenu();
setMenuVisible(true);
deathAudio();

/** The tip line under the logo: the markup ships it empty and picks at load. */
const TIPS = ["GET CLOSE TO OTHER SNAKES TO BOOST", "EAT TO GROW", "CROSS OTHER PLAYERS"];
$("tips").textContent = TIPS[Math.floor(Math.random() * TIPS.length)]!;

const bootScreen = $("bootScreen");
// The boot logo is the menu's own image, so the file stores it once.
const bootLogo = document.querySelector<HTMLImageElement>(".boot-logo");
if (bootLogo) bootLogo.src = $<HTMLImageElement>("mainLogo").src;

/**
 * Boot hand-over: drop the loader once the arena is painted, then show the menu.
 * It hangs on a drawn frame rather than a timer, so the menu never appears over
 * an empty canvas.
 */
function finishBoot() {
  bootScreen.classList.add("is-done");
  window.setTimeout(() => bootScreen.remove(), 420);
  window.setTimeout(goOnline, 1400);
}

void loadArt().then(() => {
  world = makeMenuWorld();
  startLoop();
  // Two frames: the first one starts, the second is the first one already painted
  // with the arena in it.
  requestAnimationFrame(() => requestAnimationFrame(finishBoot));
});

/* ------------------------------------------------------ the markup's hooks -- */

/**
 * Hooks the menu's inline handlers call by name: clickPlay, clickSpectate,
 * setCopy, setContinue, setReconnect, setCaptchaRetry, clickCloseAd.
 */
Object.assign(window, {
  clickPlay: (name: unknown) => {
    if (playing) return;
    const value = String(name ?? "").trim();
    if (value) nickInput.value = value.slice(0, 15);
    startGame();
  },
  clickSpectate: () => {
    if (!playing) startSpectate();
  },
  setCopy: () => void copyRoomLink(),
  setContinue: continueToMenu,
  setReconnect: reconnect,
  setCaptchaRetry: reconnect,
  clickCloseAd: () => {
    $("slot-3-wrapper").style.display = "none";
  },
});
