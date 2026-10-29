// Builds powerline-play.html: the port, the original's stylesheet, its About page
// and every asset it uses, inlined into one file.
//
// Inputs: `src/` is the port's own code and page shell, `build/assets` and
// `build/menu` are the page's media and markup. Output: powerline-play.html.
import { extname } from "node:path";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
};

async function dataUri(path: string) {
  const type = MIME[extname(path)] ?? "application/octet-stream";
  const bytes = Buffer.from(await Bun.file(path).arrayBuffer());
  return `data:${type};base64,${bytes.toString("base64")}`;
}

const ASSETS = "build/assets";
const MENU = "build/menu";

const assets: Record<string, string> = {
  __ASSET_FONT__: await dataUri(`${ASSETS}/roboto-black.ttf`),
  __ASSET_GEAR__: await dataUri(`${ASSETS}/gear.png`),
  __ASSET_LOGO__: await dataUri(`${ASSETS}/logo.png`),
  __ASSET_FAVICON__: await dataUri(`${ASSETS}/favicon.png`),
  __ASSET_FOOD__: await dataUri(`${ASSETS}/food.png`),
  __ASSET_BOOST_HINT__: await dataUri(`${ASSETS}/close-to-boost.png`),
  // The client's playfield sprite: its first tile is the board the game stands on.
  __ASSET_SHEET__: await dataUri(`${ASSETS}/sprites.png`),
  __ASSET_BADGE_IOS__: await dataUri(`${ASSETS}/badge-ios.png`),
  __ASSET_BADGE_ANDROID__: await dataUri(`${ASSETS}/badge-android.png`),
  __ASSET_DISCORD__: await dataUri(`${ASSETS}/discord.png`),
  __ASSET_REDDIT__: await dataUri(`${ASSETS}/reddit.png`),
  __ASSET_COPYCHECK__: await dataUri(`${ASSETS}/copycheck.png`),
  __ASSET_SOUND__: await dataUri(`${ASSETS}/music.ogg`),
};

/* --------------------------------------------------------------- the menu -- */

// The menu is the site's, not the port's: every panel, panel title, stat card,
// button, store badge and disconnection notice is the markup powerline.io itself
// serves, kept whole in `build/menu/body.html`. Only its references to files on
// its own host are swapped for the bytes inlined below.
let body = await Bun.file(`${MENU}/body.html`).text();
body = body.slice(body.indexOf(">", body.indexOf("<body")) + 1, body.lastIndexOf("</body>"));

const FILE_REFS: Record<string, string> = {
  "./logo.png": "__ASSET_LOGO__",
  "./badge-ios.png": "__ASSET_BADGE_IOS__",
  "./badge-android.png": "__ASSET_BADGE_ANDROID__",
  "./reddit.png": "__ASSET_REDDIT__",
  "./discord.png": "__ASSET_DISCORD__",
  "./copycheck.png": "__ASSET_COPYCHECK__",
};
for (const [reference, token] of Object.entries(FILE_REFS)) {
  if (!body.includes(reference)) throw new Error(`the menu no longer references ${reference}`);
  body = body.replaceAll(reference, token);
}

/** The index just past the `</div>` that closes the element opening at `start`. */
function afterClosingDiv(html: string, start: number) {
  let depth = 0;
  for (const match of html.slice(start).matchAll(/<div\b|<!--|<\/div>/g)) {
    if (match[0] === "</div>") {
      depth -= 1;
      if (depth === 0) return start + match.index + match[0].length;
    } else if (match[0] === "<div") {
      depth += 1;
    }
  }
  throw new Error("unbalanced <div> — the opening element has no close");
}

// The weekly standings are a service the site runs and this port does not, so the
// King of the Week stack — and the setting that only toggles its glow — are cut
// out of the menu rather than shipped empty.
const kotwStart = body.indexOf('<div id="kingOfTheWeekPanelStack"');
if (kotwStart < 0) throw new Error("the menu no longer carries the King of the Week panel stack");
body = body.slice(0, kotwStart) + body.slice(afterClosingDiv(body, kotwStart));

const kotwRow = /[ \t]*<label class="settings-row" for="settingsShowKOTWEffect">[\s\S]*?<\/label>\n/;
if (!kotwRow.test(body)) throw new Error("the settings panel no longer carries the KOTW effect row");
body = body.replace(kotwRow, "");
if (body.includes("kingOfTheWeek")) throw new Error("a King of the Week element survived the strip");

// The only line on the page that is the port's own: a plain, unlinked credit at
// the foot of the join panel, so it lives and dies with the menu.
const entryTurn = '<div hidden id="entryturn"></div>';
if (!body.includes(entryTurn)) throw new Error("the join panel has no #entryturn anchor");
body = body.replace(entryTurn, `<div id="portCredit">port by kermit.dev</div>\n\t\t\t\t\t${entryTurn}`);

// The About dialog's frame is the one place the site fetches a second page. The
// single file carries that page inside a <template> instead, so the frame is given
// the id the script fills and its src is dropped. Nothing else changes.
const aboutFrame = '<iframe class="more-info-frame" src="more_info.html" title="Powerline.io information"></iframe>';
if (!body.includes(aboutFrame)) throw new Error("the About dialog's frame is missing from build/menu/body.html");
body = body.replace(aboutFrame, '<iframe id="moreInfoFrame" class="more-info-frame" title="Powerline.io information"></iframe>');

// The ids the port's script drives. A missing one means the menu markup moved.
for (const id of [
  "xcanvas",
  "overlay",
  "basePanel",
  "mainDialog",
  "mainLogo",
  "tips",
  "topGui",
  "topGuiConnecting",
  "nick",
  "spectatorButton",
  "linkText",
  "statsPanel",
  "settingsPanel",
  "settingsToggle",
  "copyLink",
  "copyLinkBox",
  "roomlinkInput",
  "copyButton",
  "regionSelectorBox",
  "regionSelectorLabel",
  "regionSelectorOptions",
  "moreInfoOverlay",
  "moreInfoFrame",
  "debugPanel",
  "slot-1",
]) {
  if (!body.includes(`id="${id}"`) && !body.includes(`id='${id}'`)) throw new Error(`the menu markup has no #${id}`);
}

/* ------------------------------------------------------------- the styles -- */

// The original's stylesheet, with its two file references turned into the assets'
// own bytes, plus every block the live page carries inline in its head: the About
// overlay's styles, the ad slots' gating, and the slot media queries.
let styles = await Bun.file(`${ASSETS}/powerline.css`).text();
// The stylesheet declares the same face three times: Powerline Display and the
// proxima-nova-1/2 aliases. Nothing on the page asks for the aliases (checked in
// the body, the head and the About page), and three inlined copies of the 140 KB
// font is a third of the single file spent on faces nothing renders — so the
// alias rules go and the font is inlined once. Leaving them in also meant two
// relative URLs that could only 404 in a page that must stand on its own.
for (const alias of ["proxima-nova-1", "proxima-nova-2"]) {
  if (!styles.includes(`font-family:${alias}`)) throw new Error(`the stylesheet no longer declares ${alias}`);
  styles = styles.replace(new RegExp(`@font-face\\{[^}]*font-family:${alias}[^}]*\\}`, "g"), "");
}
styles = styles.replaceAll("url(./roboto-black.ttf)", `url(${assets.__ASSET_FONT__})`);
styles = styles.replace(/url\(\.\/gear\.png\)/g, `url(${assets.__ASSET_GEAR__})`);

const head = await Bun.file(`${MENU}/head.html`).text();
const inlineBlocks = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
for (const expected of [".more-info-overlay", "#slot-1", "#slot-3"]) {
  if (!inlineBlocks.some((block) => block.includes(expected))) throw new Error(`build/menu/head.html has lost its ${expected} styles`);
}
// The settings panel is laid out for the eight rows the client ships. One of them
// is the KOTW effect, so the fixed height has to lose exactly that row (34px) or
// the switch list stops short of the panel's bottom edge.
const SETTINGS_ROW = 34;
const SETTINGS_HEIGHT = 324 - SETTINGS_ROW;
assets.__STYLES__ =
  `${styles}\n${inlineBlocks.join("\n")}\n#settingsPanel { height: ${SETTINGS_HEIGHT}px; }\n`;

// The About page the launched TELL ME MORE overlay shows. It is dropped into a
// <template> as markup, not into a string, so it needs no escaping — only the one
// sequence that would end the element early.
const about = await Bun.file(`${MENU}/about.html`).text();
assets.__MORE_INFO__ = about.replace(/<\/template/gi, "<\\/template");

// The live page opens and closes its About dialog with an inline script of its own.
// That script is part of the menu, so the port runs it rather than a rewrite of it.
const menuScript = await Bun.file(`${MENU}/about-overlay.js`).text();

/* --------------------------------------------------------------- the code -- */

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  target: "browser",
  format: "iife",
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("src bundle failed");
}

let html = await Bun.file("src/index.html").text();
for (const [placeholder, replacement] of [
  ["<!-- PORT:MENU -->", () => body],
  ["<!-- PORT:MENU SCRIPT -->", () => `<script>${menuScript}</script>`],
] as const) {
  // A second copy of a placeholder would put the menu inside the stylesheet.
  if (html.split(placeholder).length !== 2) throw new Error(`src/index.html must carry exactly one ${placeholder}`);
  html = html.replace(placeholder, replacement);
}
// Function replacers: a bundle dropped in as a replacement string would have its
// `$&`, `$'`, `` $` `` sequences expanded into document text.
for (const [token, value] of Object.entries(assets)) html = html.replaceAll(token, () => value);

const bundle = (await result.outputs[0]!.text()).replaceAll("</script>", "<\\/script>");
let js = bundle;
for (const [token, value] of Object.entries(assets)) js = js.replaceAll(token, () => value);
html = html.replaceAll("__SCRIPT__", () => js);

await Bun.write("powerline-play.html", html);
const size = (await Bun.file("powerline-play.html").size) / 1024;
console.log(`powerline-play.html — ${size.toFixed(0)} KB`);
