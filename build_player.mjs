#!/usr/bin/env node
// 把 alphaTab、樂譜字型、音源、所有樂譜檔,全部塞進一份 output/score_player.html。
// 為什麼要塞成一份:開一個網址就能用,不會發生「少帶了旁邊某個檔」的問題。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const at = path.join(root, "node_modules", "@coderline", "alphatab", "dist");

const paths = {
  template: path.join(root, "web", "player.html"),
  css: path.join(root, "web", "player.css"),
  app: path.join(root, "web", "player.js"),
  editor: path.join(root, "web", "editor.js"),
  saxfingering: path.join(root, "web", "saxfingering.js"),
  fretboard: path.join(root, "web", "fretboard.js"),
  keydetect: path.join(root, "web", "keydetect.js"),
  alphatab: path.join(at, "alphaTab.min.js"),
  font: path.join(at, "font", "Bravura.woff2"),
  // sf3 比 sf2 小了 37%(977KB vs 1.35MB),聽起來一樣,所以用 sf3。
  soundfont: path.join(at, "soundfont", "sonivox.sf3"),
  scores: path.join(root, "scores"),
  generated: path.join(root, "output"),
  output: path.join(root, "output", "score_player.html"),
};

for (const [name, filePath] of Object.entries(paths)) {
  if (["output", "scores", "generated"].includes(name)) continue;
  if (!fs.existsSync(filePath)) throw new Error(`少了打包要用的檔案:${filePath}`);
}

// 播放器裡有哪些曲子:output/ 裡由產生器產出的 MusicXML 排在前面,再加上 scores/ 底下所有樂譜檔。
// 兩個資料夾都可以不存在;alphaTab 讀得懂 Guitar Pro 3~7 與 MusicXML,所以不必先轉檔。
const READABLE = new Set([".gp", ".gp3", ".gp4", ".gp5", ".gpx", ".musicxml", ".xml", ".mxl"]);
const listScores = (dir, exts) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).sort()
    .filter((name) => exts.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(dir, name))
  : []);
const songFiles = [
  ...listScores(paths.generated, new Set([".musicxml"])),
  ...listScores(paths.scores, READABLE),
];
if (!songFiles.length) throw new Error("scores/ 裡一份樂譜都沒有");

const library = songFiles.map((file) => ({
  file: path.basename(file),
  // 標題留空,讓 alphaTab 從檔案內容自己讀 ——  不要在這裡再抄一份會過期的歌名。
  title: path.basename(file, path.extname(file)).replace(/_/g, " "),
  artist: "",
  data: fs.readFileSync(file).toString("base64"),
}));

const escapeScript = (value) => value.replaceAll("</script", "<\\/script");
const assets = {
  font: fs.readFileSync(paths.font).toString("base64"),
  soundfont: fs.readFileSync(paths.soundfont).toString("base64"),
};

const replacements = {
  "/*__PLAYER_CSS__*/": fs.readFileSync(paths.css, "utf8"),
  "/*__ALPHATAB_JS__*/": escapeScript(fs.readFileSync(paths.alphatab, "utf8")),
  "/*__ASSETS__*/": escapeScript(
    `window.AT_ASSETS=${JSON.stringify(assets)};window.SCORE_LIBRARY=${JSON.stringify(library)};`,
  ),
  "/*__PLAYER_JS__*/": escapeScript(fs.readFileSync(paths.app, "utf8")),
  "/*__EDITOR_JS__*/": escapeScript(fs.readFileSync(paths.editor, "utf8")),
  // 薩克斯風要排在指板前面 —— 指板會去呼叫 window.scoreSaxFingering。
  "/*__SAXFINGERING_JS__*/": escapeScript(fs.readFileSync(paths.saxfingering, "utf8")),
  "/*__FRETBOARD_JS__*/": escapeScript(fs.readFileSync(paths.fretboard, "utf8")),
  "/*__KEYDETECT_JS__*/": escapeScript(fs.readFileSync(paths.keydetect, "utf8")),
};

let html = fs.readFileSync(paths.template, "utf8");
for (const [marker, value] of Object.entries(replacements)) {
  if (!html.includes(marker)) throw new Error(`樣板裡少了這個記號:${marker}`);
  html = html.replace(marker, value);
}

fs.mkdirSync(path.dirname(paths.output), { recursive: true });
fs.writeFileSync(paths.output, html);

const megabytes = (fs.statSync(paths.output).size / 1024 / 1024).toFixed(1);
console.log(`${paths.output}  (${library.length} 首 / ${megabytes} MB)`);
for (const song of library) console.log(`  · ${song.file}`);
