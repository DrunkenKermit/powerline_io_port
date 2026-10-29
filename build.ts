// Builds singlefile.html: the game, the menu markup and stylesheet, the About
// page and every image, font and sound, inlined into one document.
//
// Sources: src/ (the game and the page shell) and build/ (menu markup, media).
import { extname } from "node:path";

const OUTPUT = "singlefile.html";
const ASSETS = "build/assets";
const MENU = "build/menu";

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

const font = await dataUri(`${ASSETS}/roboto-black.ttf`);
const gear = await dataUri(`${ASSETS}/gear.png`);
const logo = await dataUri(`${ASSETS}/logo.png`);
const favicon = await dataUri(`${ASSETS}/favicon.png`);
const food = await dataUri(`${ASSETS}/food.png`);
const boostHint = await dataUri(`${ASSETS}/close-to-boost.png`);
const sprites = await dataUri(`${ASSETS}/sprites.png`);
const badgeIos = await dataUri(`${ASSETS}/badge-ios.png`);
const badgeAndroid = await dataUri(`${ASSETS}/badge-android.png`);
const discord = await dataUri(`${ASSETS}/discord.png`);
const reddit = await dataUri(`${ASSETS}/reddit.png`);
const copycheck = await dataUri(`${ASSETS}/copycheck.png`);
const music = await dataUri(`${ASSETS}/music.ogg`);

const tokens: Record<string, string> = {
  __ASSET_FONT__: font,
  __ASSET_LOGO__: logo,
  __ASSET_FAVICON__: favicon,
  __ASSET_FOOD__: food,
  __ASSET_BOOST_HINT__: boostHint,
  __ASSET_SHEET__: sprites,
  __ASSET_BADGE_IOS__: badgeIos,
  __ASSET_BADGE_ANDROID__: badgeAndroid,
  __ASSET_DISCORD__: discord,
  __ASSET_REDDIT__: reddit,
  __ASSET_COPYCHECK__: copycheck,
  __ASSET_SOUND__: music,
};

/* ------------------------------------------------------------------ menu -- */

// The menu markup, minus its own <html>/<body> wrapper.
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
  if (!body.includes(reference)) throw new Error(`body.html no longer references ${reference}`);
  body = body.replaceAll(reference, token);
}

/** Index just past the </div> that closes the element opening at `start`. */
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
  throw new Error("unbalanced <div>: element has no close");
}

// The weekly standings need the live service, so the panel and the setting that
// only toggles its glow come out.
const kotwStart = body.indexOf('<div id="kingOfTheWeekPanelStack"');
if (kotwStart < 0) throw new Error("no King of the Week panel stack in body.html");
body = body.slice(0, kotwStart) + body.slice(afterClosingDiv(body, kotwStart));

const kotwRow = /[ \t]*<label class="settings-row" for="settingsShowKOTWEffect">[\s\S]*?<\/label>\n/;
if (!kotwRow.test(body)) throw new Error("no KOTW effect row in the settings panel");
body = body.replace(kotwRow, "");
if (body.includes("kingOfTheWeek")) throw new Error("a King of the Week element survived the strip");

const entryTurn = '<div hidden id="entryturn"></div>';
if (!body.includes(entryTurn)) throw new Error("join panel has no #entryturn anchor");
body = body.replace(entryTurn, `<div id="portCredit">port by kermit.dev</div>\n\t\t\t\t\t${entryTurn}`);

// The About dialog normally loads a second page. It ships inside a <template>
// here, so the frame keeps its class and loses its src.
const aboutFrame = '<iframe class="more-info-frame" src="more_info.html" title="Powerline.io information"></iframe>';
if (!body.includes(aboutFrame)) throw new Error("About frame missing from body.html");
body = body.replace(aboutFrame, '<iframe id="moreInfoFrame" class="more-info-frame" title="Powerline.io information"></iframe>');

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
  if (!body.includes(`id="${id}"`) && !body.includes(`id='${id}'`)) throw new Error(`body.html has no #${id}`);
}

/* ---------------------------------------------------------------- styles -- */

let styles = await Bun.file(`${ASSETS}/powerline.css`).text();

// Three @font-face rules point at the same font through different family names.
// Only "Powerline Display" is used anywhere, and inlining the file three times
// would cost ~280 KB, so the aliases go.
for (const alias of ["proxima-nova-1", "proxima-nova-2"]) {
  if (!styles.includes(`font-family:${alias}`)) throw new Error(`powerline.css no longer declares ${alias}`);
  styles = styles.replace(new RegExp(`@font-face\\{[^}]*font-family:${alias}[^}]*\\}`, "g"), "");
}
styles = styles.replaceAll("url(./roboto-black.ttf)", `url(${font})`);
// The gear is masked twice on the same element (webkit + standard); one copy
// behind a custom property keeps the image out of the file twice.
styles = styles.replaceAll("url(./gear.png)", "var(--gear)");
styles = `:root{--gear:url(${gear})}${styles}`;

const head = await Bun.file(`${MENU}/head.html`).text();
const inlineBlocks = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!);
for (const expected of [".more-info-overlay", "#slot-1", "#slot-3"]) {
  if (!inlineBlocks.some((block) => block.includes(expected))) throw new Error(`head.html lost its ${expected} styles`);
}

const stylesheet = `${styles}\n${inlineBlocks.join("\n")}\n`;

const about = await Bun.file(`${MENU}/about.html`).text();
const moreInfo = about.replace(/<\/template/gi, "<\\/template");
const menuScript = await Bun.file(`${MENU}/about-overlay.js`).text();

/* ------------------------------------------------------------------ code -- */

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

// Replacers are functions so that "$&" and friends in an asset are not expanded
// as replacement patterns.
const fill = (text: string) => {
  let out = text;
  for (const [token, value] of Object.entries(tokens)) out = out.replaceAll(token, () => value);
  return out;
};

for (const [placeholder, value] of [
  ["<!-- MENU -->", body],
  ["<!-- MENU SCRIPT -->", `<script>${menuScript}</script>`],
] as const) {
  if (html.split(placeholder).length !== 2) throw new Error(`index.html must have exactly one ${placeholder}`);
  html = html.replace(placeholder, () => value);
}

const script = (await result.outputs[0]!.text()).replaceAll("</script>", "<\\/script>");
html = fill(
  html
    .replaceAll("__STYLES__", () => fill(stylesheet))
    .replaceAll("__MORE_INFO__", () => moreInfo)
    .replaceAll("__SCRIPT__", () => script),
);

await Bun.write(OUTPUT, html);
console.log(`${OUTPUT} — ${((await Bun.file(OUTPUT).size) / 1024).toFixed(0)} KB`);
