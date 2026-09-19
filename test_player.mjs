#!/usr/bin/env node
// 用真的 Chrome 操作播放器,逐項驗。 rc=0 不代表好看,截圖要用眼睛看過。
//
// 為什麼要起一個臨時的網頁伺服器:
//   alphaTab 的合成器住在背景執行緒,而瀏覽器不讓 file:// 的網頁開背景執行緒。
//   用 file:// 測等於只測得到「看得見」,測不到「聽得到」。
//   這個伺服器只綁 127.0.0.1、用系統隨機給的埠、測完就關,不是交付用的。

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(root, "output", "score_player.html");
const shots = {
  main: path.join(root, "tmp", "player-main.png"),
  tabOnly: path.join(root, "tmp", "player-tab-only.png"),
  firstSong: path.join(root, "tmp", "player-first-song.png"),
  looping: path.join(root, "tmp", "player-loop.png"),
  cursor: path.join(root, "tmp", "player-cursor.png"),
  dark: path.join(root, "tmp", "player-dark.png"),
  editor: path.join(root, "tmp", "player-editor.png"),
  fretboard: path.join(root, "tmp", "player-fretboard.png"),
  sax: path.join(root, "tmp", "player-sax.png"),
};
if (!fs.existsSync(htmlPath)) throw new Error(`找不到播放器:${htmlPath}。先跑 npm run build`);
fs.mkdirSync(path.join(root, "tmp"), { recursive: true });

const html = fs.readFileSync(htmlPath);
const server = http.createServer((request, response) => {
  if (request.url.startsWith("/player")) {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  } else if (request.url === "/favicon.ico") {
    response.writeHead(204).end();  // 瀏覽器一定會要,不回它就會在主控台留一條假的錯誤
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/player`;

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});

const problems = [];
const check = (label, condition, detail = "") => {
  if (condition) console.log(`check: ${label}`);
  else problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("favicon")) consoleErrors.push(text);
  });

  const snapshot = () => page.evaluate(() => window.scorePlayer.getSnapshot());
  const settle = async (ms = 400) => page.waitForTimeout(ms);
  // 只等 data-app-ready 不夠:切歌或切音軌會排版兩次,中間有一瞬間譜是空的。
  //    要等到「旗標是好的、而且畫面上真的有譜」才算排完。
  const rendered = async () => {
    await page.waitForFunction(
      () => document.querySelector(".app").dataset.appReady === "true"
        && document.querySelectorAll("#alphatab svg").length > 0,
      null, { timeout: 60000 },
    );
    await page.waitForTimeout(250);
  };

  await page.goto(base, { waitUntil: "load" });
  await rendered();
  let snap = await snapshot();
  check("預設樂譜排出來了", snap.ready);

  // 指定曲目的檢查:測試用的 Guitar Pro 曲目與它的預期值寫在 scores/expected.json。
  // 有版權的曲目不隨公開版散布;沒有這份檔時,只跑不依賴特定曲目的檢查。
  const expectedPath = path.join(root, "scores", "expected.json");
  const expected = fs.existsSync(expectedPath) ? JSON.parse(fs.readFileSync(expectedPath, "utf8")) : {};
  const gp = expected.guitarPro ?? null;
  const songs = await page.locator("#song-select option").allTextContents();

  songSpecific: {
    if (!gp) {
      console.log("skip: scores/expected.json 沒有 Guitar Pro 測試曲目,略過指定曲目的檢查");
      break songSpecific;
    }
    // 曲目:切到 Guitar Pro 檔(直接讀,沒有先轉檔)
    const gpIndex = songs.findIndex((label) => label.includes(gp.label));
    check("曲目清單有 Guitar Pro 檔", gpIndex >= 0, songs.join(" / "));
    await page.selectOption("#song-select", String(gpIndex));
    await page.waitForFunction((n) => window.scorePlayer.getSnapshot().trackCount === n, gp.tracks, { timeout: 60000 });
    await rendered();
    snap = await snapshot();
    check(`Guitar Pro 檔直接讀進來(${snap.trackCount} 軌 / ${snap.barCount} 小節)`,
      snap.trackCount === gp.tracks && snap.barCount === gp.bars, JSON.stringify(snap.trackNames));
    check(`預設只看第一軌(${gp.tracks} 軌疊在一起會擠到一行只剩兩小節)`,
      snap.shownTracks.length === 1, JSON.stringify(snap.shownTracks));
    check("歌名與作者從檔案裡讀到", snap.title === gp.title && snap.artist === gp.artist,
      `${snap.title} / ${snap.artist}`);

    // 譜面:五線譜與六線譜要疊在一起(Guitar Pro 的預設)
    const staffLines = await page.locator("#alphatab svg").count();
    check("譜面畫出來了", staffLines > 0, `svg=${staffLines}`);
    await page.screenshot({ path: shots.main });

    // 播放器:要真的能出聲(音源有沒有載進去)
    await page.waitForFunction(() => window.scorePlayer.getSnapshot().playerReady, null, { timeout: 40000 });
    check("音源載好了,播得出聲音", (await snapshot()).playerReady);

    // 音軌清單:靜音、獨奏、只看一軌
    check("左邊列出 8 軌", await page.locator(".track").count() === 8);
    // gp5 的文字是 Windows-1252 存的,用 UTF-8 讀會把「Percusión」變成「Percusi◆n」。
    // 那種壞法不會報錯,只會靜靜地顯示錯字 —— 所以要驗。
    check("音軌名的西文字母沒變成亂碼",
      snap.trackNames.includes(gp.trackName), snap.trackNames.join(" / "));
    await page.locator(".track").nth(2).locator(".chip").first().click();
    await page.locator(".track").nth(5).locator(".chip").nth(1).click();
    snap = await snapshot();
    check("靜音與獨奏各自生效", snap.muted.includes(2) && snap.soloed.includes(5), JSON.stringify(snap));
    await page.locator(".track").nth(2).locator(".chip").first().click();
    await page.locator(".track").nth(5).locator(".chip").nth(1).click();

    await page.locator(".track").nth(2).locator(".track-name").click();
    await rendered();
    snap = await snapshot();
    check("點軌名只看那一軌", snap.shownTracks.length === 1 && snap.shownTracks[0] === 2, JSON.stringify(snap.shownTracks));
    await page.click("#track-all");
    await rendered();
    check("按全部顯示會把 8 軌一起排出來", (await snapshot()).shownTracks.length === 8);
    await page.locator(".track").first().locator(".track-name").click();
    await rendered();
    check("再點一軌會回到只看那一軌", (await snapshot()).shownTracks.length === 1);

    // 顯示方式:三種都要能切
    await page.click("[data-stave='Tab']");
    await rendered();
    check("切到只看六線譜", (await snapshot()).stave === "Tab");
    await page.screenshot({ path: shots.tabOnly });
    await page.click("[data-stave='ScoreTab']");
    await rendered();
    check("切回五線譜＋六線譜", (await snapshot()).stave === "ScoreTab");

    // 跳小節
    await page.evaluate(() => window.scorePlayer.seekToBar(40));
    await settle();
    snap = await snapshot();
    check(`跳到第 40 小節(現在第 ${snap.bar} 小節)`, Math.abs(snap.bar - 40) <= 1, JSON.stringify(snap.bar));
    await page.click("#next-bar");
    await settle();
    const afterNext = (await snapshot()).bar;
    await page.click("#prev-bar");
    await settle();
    const afterPrev = (await snapshot()).bar;
    check("上一小節／下一小節會動", afterNext > snap.bar && afterPrev < afterNext, `${snap.bar}→${afterNext}→${afterPrev}`);

    // 練習用的開關
    await page.fill("#speed", "50");
    await page.dispatchEvent("#speed", "input");
    await settle(200);
    check("速度調得動", Math.abs((await snapshot()).speed - 0.5) < 0.01);
    await page.click("#metronome");
    await page.click("#countin");
    snap = await snapshot();
    check("節拍器與預備拍打得開", snap.metronome && snap.countIn, JSON.stringify(snap));
    await page.click("#loop");
    check("循環打得開", (await snapshot()).looping);
    await page.screenshot({ path: shots.looping });
    await page.click("#loop");

    // ── 在譜上拖一段來循環 ──
    await page.evaluate(() => window.scorePlayer.seekToBar(14));
    await settle(800);
    const dragPoints = await page.evaluate(() => {
      // 拖曳要跨過好幾個拍。同一個和弦的幾根弦是同一個拍,拖那個等於沒拖。
      const rows = new Map();
      for (const node of document.querySelectorAll("#alphatab svg text")) {
        if (!/^\s*\d+\s*$/.test(node.textContent ?? "")) continue;
        const box = node.getBoundingClientRect();
        if (box.width === 0 || box.top < 200 || box.bottom > window.innerHeight - 200) continue;
        const row = Math.round(box.top / 40);
        if (!rows.has(row)) rows.set(row, []);
        rows.get(row).push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
      }
      let best = [];
      for (const list of rows.values()) if (list.length > best.length) best = list;
      best.sort((a, b) => a.x - b.x);
      return best.length >= 2 ? [best[0], best.at(-1)] : null;
    });
    if (dragPoints) {
      await page.mouse.move(dragPoints[0].x, dragPoints[0].y);
      await page.mouse.down();
      for (let step = 1; step <= 8; step += 1) {
        await page.mouse.move(
          dragPoints[0].x + ((dragPoints[1].x - dragPoints[0].x) * step) / 8,
          dragPoints[0].y + ((dragPoints[1].y - dragPoints[0].y) * step) / 8,
        );
        await page.waitForTimeout(50);
      }
      await page.mouse.up();
      await settle(700);
      snap = await snapshot();
      check("在譜上拖得出一段選取範圍", snap.range && snap.range.endTick > snap.range.startTick, JSON.stringify(snap.range));
      // 選取框沒有顏色的話,拖曳時看起來會像沒有反應
      const selection = await page.evaluate(() => {
        const inner = document.querySelector(".at-selection div");
        if (!inner) return null;
        const box = inner.getBoundingClientRect();
        return { background: getComputedStyle(inner).backgroundColor, width: Math.round(box.width), height: Math.round(box.height) };
      });
      check("選取的那一段看得見(有底色)",
        selection && selection.width > 50 && selection.height > 10 && !/rgba?\(0, 0, 0, 0\)|transparent/.test(selection.background),
        JSON.stringify(selection));

      await page.click("#loop");
      await settle(600);
      snap = await snapshot();
      check("開循環會直接跳到那一段的開頭",
        snap.looping && snap.tick >= snap.range.startTick && snap.tick < snap.range.endTick,
        JSON.stringify({ tick: snap.tick, range: snap.range }));
      await page.click("#loop");
      await page.evaluate(() => { window.at.playbackRange = null; });
    } else {
      problems.push("譜面上找不到可以拖曳的兩個點");
    }
    await page.click("#metronome");
    await page.click("#countin");
    await page.fill("#speed", "100");
    await page.dispatchEvent("#speed", "input");

    // 真的播一段,確認時間軸在走
    await page.evaluate(() => window.scorePlayer.seekToBar(1));
    await page.click("#play");
    await page.waitForTimeout(2200);
    snap = await snapshot();
    check(`按下去真的在播(第 ${snap.bar} 小節 / ${Math.round(snap.time)} 毫秒)`, snap.playing && snap.time > 500, JSON.stringify(snap));
    await page.click("#play");
    await settle();
    check("再按一次會暫停", !(await snapshot()).playing);
    await page.click("#stop");
    await settle();
    check("停止會回到開頭", (await snapshot()).time < 200);

    // 點譜面任一處要能跳位置(alphaTab 的滑鼠互動)。
    // 不要點固定座標然後斷言「跳到第幾小節」—— 畫面捲到哪裡會影響點到誰,
    //    那種測試會今天過、明天不過。改成比較「點之前 vs 點之後」。
    await page.evaluate(() => window.scorePlayer.seekToBar(1));
    await settle(600);
    const before = (await snapshot()).bar;
    // 不要猜座標點下去 —— 點到小節之間的空白就什麼都不會發生,測試會時好時壞。
    //    改成挑一個「六線譜上真的印著格位數字」的位置點。
    const target = await page.evaluate(() => {
      // 取「畫面上最後一個」格位數字 —— 取第一個的話會點到第 1 小節,
      // 而測試前才剛跳到第 1 小節,點了等於沒動,測試會誤判成壞掉。
      let last = null;
      for (const node of document.querySelectorAll("#alphatab svg text")) {
        if (!/^\s*\d+\s*$/.test(node.textContent ?? "")) continue;
        const box = node.getBoundingClientRect();
        if (box.width > 0 && box.top > 120 && box.bottom < window.innerHeight - 120) {
          last = { x: box.x + box.width / 2, y: box.y + box.height / 2, label: node.textContent.trim() };
        }
      }
      return last;
    });
    if (target) {
      await page.mouse.click(target.x, target.y);
      await settle(600);
      const after = (await snapshot()).bar;
      check(`點譜上的格位「${target.label}」會跳過去(第 ${before} → 第 ${after} 小節)`, after !== before, `${before} → ${after}`);
    } else {
      problems.push("譜面上找不到格位數字,沒辦法測點擊");
    }

    // 播放游標:要看得到一條線,而且是設定的顏色
    await page.evaluate(() => window.scorePlayer.seekToBar(14));
    await page.click("#play");
    // 不要固定等幾毫秒 —— 標記要等音符真的響起來才會出現,等太短會抓到空的。
    await page.waitForFunction(() => document.querySelectorAll(".at-highlight").length > 0, null, { timeout: 15000 })
      .catch(() => {});
    const cursor = await page.evaluate(() => {
      const beat = document.querySelector(".at-cursor-beat");
      const bar = document.querySelector(".at-cursor-bar");
      if (!beat) return null;
      const style = getComputedStyle(beat);
      const box = beat.getBoundingClientRect();
      return {
        color: style.backgroundColor,
        width: box.width,
        visible: box.width > 0 && box.height > 0,
        hasBar: Boolean(bar),
        highlighted: document.querySelectorAll(".at-highlight").length,
      };
    });
    await page.screenshot({ path: shots.cursor });
    await page.click("#play");
    check("播放時有一條紅色的游標線",
      cursor?.visible && cursor.color === "rgb(224, 49, 49)" && cursor.width >= 2,
      JSON.stringify(cursor));
    check("現在這一小節有底色、正在響的音符有標起來",
      cursor?.hasBar && cursor.highlighted > 0, JSON.stringify(cursor));

    // 音色:換樂器要真的改到那一軌的 MIDI 樂器編號,而且改完還播得動
    const beforePrograms = (await snapshot()).programs.slice();
    await page.click("#mixer-button");
    await page.waitForSelector("#mixer[open]");
    check("音色面板每一軌一列", await page.locator(".mixer-row").count() === 8);
    await page.selectOption(".mixer-row select[data-track='2']", "24");
    await rendered();
    snap = await snapshot();
    check(`換樂器改到了那一軌(${beforePrograms[2]} → ${snap.programs[2]})`,
      snap.programs[2] === 24 && snap.programs[0] === beforePrograms[0],
      JSON.stringify(snap.programs));
    await page.locator(".mixer-row input[data-volume='3']").fill("4");
    await page.dispatchEvent(".mixer-row input[data-volume='3']", "input");
    await page.evaluate(() => document.querySelector("#mixer").close());
    await page.click("#play");
    await page.waitForTimeout(1500);
    check("換完樂器還播得動", (await snapshot()).playing);
    await page.click("#play");

    // 外觀:游標顏色與譜面配色
    await page.click("#look-button");
    await page.waitForSelector("#look[open]");
    check("游標顏色有得挑", await page.locator(".swatch").count() >= 4);
    await page.click('.swatch[data-color="#1971c2"]');
    await page.click('[data-theme="dark"]');
    snap = await snapshot();
    const themed = await page.evaluate(() => ({
      cursor: getComputedStyle(document.documentElement).getPropertyValue("--cursor").trim(),
      theme: document.querySelector("#alphatab").dataset.theme,
    }));
    check("換游標顏色與深色配色都有效", snap.cursorColor === "#1971c2" && themed.theme === "dark" && themed.cursor === "#1971c2",
      JSON.stringify({ ...snap && { cursorColor: snap.cursorColor }, ...themed }));
    await page.screenshot({ path: shots.dark });
    await page.click("#look-reset");
    await page.evaluate(() => document.querySelector("#look").close());
    check("還原預設會回到紅色白紙", (await snapshot()).cursorColor === "#e03131");

    // ── 移調、列印 ──
    await page.selectOption("#transpose", "2");
    await settle(600);
    check("移調設得動", (await snapshot()).transpose === 2, JSON.stringify((await snapshot()).transpose));
    await page.click("#play");
    await settle(1200);
    check("移調之後還播得動", (await snapshot()).playing);
    await page.click("#play");
    await page.selectOption("#transpose", "0");
    await settle(400);
    check("移調回得了原調", (await snapshot()).transpose === 0);

    // alphaTab 內建的 print():會另開一個乾淨的排版視窗,不是把整個介面印出來
    const printPopup = page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null);
    await page.click("#print-button");
    const opened = await printPopup;
    check("列印開得出視窗", Boolean(opened));
    if (opened) {
      await opened.waitForTimeout(1500);
      check("列印視窗裡真的有譜", (await opened.locator("svg").count()) > 0);
      await opened.close();
    }

    // ── 調性:這首歌聽起來是什麼調 ──
    const key = await page.evaluate(() => window.scoreKey.getSnapshot());
    check(`調性徽章有顯示(${key.badge})`, key.visible && key.badge.length > 2, JSON.stringify(key.badge));
    check(`算出來的調跟譜上標的一致(譜上 ${key.written} / 聽起來 ${key.heard?.name})`,
      key.written === key.heard?.name, JSON.stringify({ written: key.written, heard: key.heard?.name }));
    check(`把握程度夠(相關 ${key.heard?.score.toFixed(2)},跟第二名差 ${key.heard?.gap.toFixed(2)})`,
      key.heard?.score > 0.7 && key.heard?.gap > 0.05, JSON.stringify(key.heard));

    // ── 指板圖:播到哪就亮哪幾格 ──
    await page.click("#fretboard-button");
    await settle(500);
    let fb = await page.evaluate(() => window.scoreFretboard.getSnapshot());
    check(`指板打得開(${fb.strings} 弦)`, fb.on && fb.strings === 6, JSON.stringify(fb));

    await page.evaluate(() => window.scorePlayer.seekToBar(14));
    await page.click("#play");
    // 不要等固定秒數 —— 要等到真的有音在響
    await page.waitForFunction(() => window.scoreFretboard.getSnapshot().active.length > 0, null, { timeout: 20000 })
      .catch(() => {});
    fb = await page.evaluate(() => window.scoreFretboard.getSnapshot());
    await page.click("#play");
    check(`播放時指板會亮(${fb.active.map((a) => `${a.string}弦${a.fret}格`).join("+") || "沒亮"})`,
      fb.active.length > 0 && fb.dots > 0, JSON.stringify(fb));
    // 暫停之後手型要留著,人是停在那裡看著練的
    check("暫停後指板還留著最後的手型",
      (await page.evaluate(() => window.scoreFretboard.getSnapshot())).active.length > 0,
      JSON.stringify((await page.evaluate(() => window.scoreFretboard.getSnapshot())).active));
    check("亮的位置在合理範圍內",
      fb.active.every((a) => a.string >= 1 && a.string <= 6 && a.fret >= 0 && a.fret <= 24),
      JSON.stringify(fb.active));
    await page.screenshot({ path: shots.fretboard });

    // 換到貝斯,指板要跟著變成四條弦
    const bassIndex = (await page.locator(".track .track-name").allTextContents()).findIndex((n) => n.includes("Bass"));
    await page.locator(".track").nth(bassIndex).locator(".track-name").click();
    await rendered();
    await settle(400);
    check("換到貝斯指板變成 4 弦", (await page.evaluate(() => window.scoreFretboard.getSnapshot())).strings === 4,
      JSON.stringify((await page.evaluate(() => window.scoreFretboard.getSnapshot())).strings));

    // 打擊軌沒有指板,要明確說明,而不是畫一塊空白
    const percIndex = (await page.locator(".track .track-name").allTextContents()).findIndex((n) => n.includes("Percusi"));
    await page.locator(".track").nth(percIndex).locator(".track-name").click();
    await rendered();
    await settle(400);
    const fbText = (await page.textContent("#fretboard")) ?? "";
    check("打擊軌會明講沒有指板", fbText.includes("沒有指板"), fbText.trim().slice(0, 30));

    // 切回吉他,關掉指板
    await page.locator(".track").nth(2).locator(".track-name").click();
    await rendered();
    await page.click("#fretboard-button");
    check("指板關得掉", !(await page.evaluate(() => window.scoreFretboard.getSnapshot())).on);

    // ── 速度訓練器:每重複一輪自動加快,到原速停 ──
    await page.evaluate(() => {
      const bars = window.at.score.masterBars;
      const range = new alphaTab.synth.PlaybackRange();
      range.startTick = bars[13].start;
      range.endTick = bars[15].start;   // 兩小節,繞一輪很快
      window.at.playbackRange = range;
      window.at.tickPosition = range.startTick;
    });
    await page.click("#loop");
    await page.fill("#speed", "90");
    await page.dispatchEvent("#speed", "input");
    await page.click("#trainer");
    await settle(300);
    check("漸快打得開", (await snapshot()).trainer);

    await page.click("#play");
    // 不要等固定秒數 —— 繞一輪要多久跟速度有關,寫死會今天過明天不過。
    await page.waitForFunction(() => window.scorePlayer.getSnapshot().trainerRound >= 1, null, { timeout: 30000 })
      .catch(() => {});
    snap = await snapshot();
    check(`播完一輪速度自己加上去(90% → ${Math.round(snap.speed * 100)}%)`,
      snap.speed > 0.9 && snap.trainerRound >= 1, JSON.stringify({ speed: snap.speed, round: snap.trainerRound }));

    // 再繞一輪就會到 100%,然後自己關掉
    await page.waitForFunction(() => {
      const s = window.scorePlayer.getSnapshot();
      return !s.trainer && Math.round(s.speed * 100) === 100;
    }, null, { timeout: 40000 }).catch(() => {});
    snap = await snapshot();
    check("回到原速就自己關掉漸快", !snap.trainer && Math.round(snap.speed * 100) === 100, JSON.stringify(snap.trainer));
    check("加速的過程沒有把循環弄斷", snap.looping, JSON.stringify(snap.looping));
    await page.click("#play");
    await page.click("#loop");
    await page.evaluate(() => { window.at.playbackRange = null; });

    // ── 編輯樂譜 ──
    await page.click("#edit-button");
    await settle(500);
    let ed = await page.evaluate(() => window.scoreEditor.getSnapshot());
    check("進得了編輯模式", ed.on && await page.locator("#edit-bar").isVisible());

    check("選得到音符", await page.evaluate(() => window.scoreEditor.selectFirstNote()));
    await settle(700);
    ed = await page.evaluate(() => window.scoreEditor.getSnapshot());
    const original = { string: ed.string, fret: ed.fret };
    check(`選到第 ${ed.string} 弦第 ${ed.fret} 格`, ed.hasNote && Number.isFinite(ed.fret), JSON.stringify(ed));

    await page.evaluate(() => window.scoreEditor.typeFret("7"));
    await settle(700);
    ed = await page.evaluate(() => window.scoreEditor.getSnapshot());
    check(`按數字改得動格位(${original.fret} → ${ed.fret})`, ed.fret === 7 && ed.dirty, JSON.stringify(ed));

    await page.evaluate(() => window.scoreEditor.undoLast());
    await settle(700);
    ed = await page.evaluate(() => window.scoreEditor.getSnapshot());
    check(`收得回上一步(回到 ${ed.fret} 格)`, ed.fret === original.fret && ed.undoDepth === 0, JSON.stringify(ed));

    await page.evaluate(() => window.scoreEditor.setDuration(8));
    await settle(700);
    check("改得動音長", (await page.evaluate(() => window.scoreEditor.getSnapshot())).duration === 8);

    await page.evaluate(() => window.scoreEditor.deleteSelected());
    await settle(700);
    check("刪得掉音符", !(await page.evaluate(() => window.scoreEditor.getSnapshot())).hasNote);
    await page.evaluate(() => window.scoreEditor.undoLast());
    await settle(700);
    check("刪掉的音收得回來", (await page.evaluate(() => window.scoreEditor.getSnapshot())).hasNote);

    // 不要固定往同一個方向移 —— 選到的如果剛好是最外側那條弦,移不動,測試會誤判成壞掉。
    const toward = original.string >= 3 ? -1 : 1;
    await page.evaluate((step) => window.scoreEditor.moveString(step), toward);
    await settle(500);
    const moved = await page.evaluate(() => window.scoreEditor.getSnapshot());
    check(`上下鍵換得動弦(第 ${original.string} → 第 ${moved.string} 弦)`, moved.string !== original.string, JSON.stringify(moved.string));
    await page.screenshot({ path: shots.editor });

    // 加一拍 / 刪一拍
    const beatsBefore = (await page.evaluate(() => window.scoreEditor.getSnapshot())).beatsInBar;
    await page.click("#beat-add");
    await settle(700);
    const afterAdd = (await page.evaluate(() => window.scoreEditor.getSnapshot())).beatsInBar;
    check(`加得了一拍(${beatsBefore} → ${afterAdd})`, afterAdd === beatsBefore + 1);
    await page.evaluate(() => window.scoreEditor.undoLast());
    await settle(700);
    await page.click("#beat-delete");
    await settle(700);
    const afterDelete = (await page.evaluate(() => window.scoreEditor.getSnapshot())).beatsInBar;
    check(`刪得了一拍(${beatsBefore} → ${afterDelete})`, afterDelete === beatsBefore - 1);
    await page.evaluate(() => window.scoreEditor.undoLast());
    await settle(700);
    check("加減拍都收得回來",
      (await page.evaluate(() => window.scoreEditor.getSnapshot())).beatsInBar === beatsBefore);

    // 最重要的一項:改完存出來的檔案,自己要讀得回來,而且改動要還在。
    //    這一項壞掉的話,他改了半天全部白改,而且不會有任何錯誤訊息。
    await page.evaluate(() => window.scoreEditor.selectFirstNote());
    await settle(500);
    await page.evaluate(() => { window.scoreEditor.typeFret("1"); window.scoreEditor.typeFret("3"); });
    await settle(800);
    const edited = await page.evaluate(() => window.scoreEditor.getSnapshot());
    const exported = await page.evaluate(() => {
      const bytes = new alphaTab.exporter.Gp7Exporter().export(window.at.score, window.at.settings);
      let out = ""; for (const b of bytes) out += String.fromCharCode(b);
      return btoa(out);
    });
    const savedPath = path.join(root, "tmp", "edited-roundtrip.gp");
    fs.writeFileSync(savedPath, Buffer.from(exported, "base64"));
    check(`存得出 .gp 檔(${fs.statSync(savedPath).size} bytes)`, fs.statSync(savedPath).size > 10000);

    await page.setInputFiles("#score-file", savedPath);
    await page.waitForFunction((n) => window.scorePlayer.getSnapshot().trackCount === n, gp.tracks, { timeout: 60000 }).catch(() => {});
    await rendered();
    snap = await snapshot();
    check(`存出來的檔自己讀得回來(${snap.trackCount} 軌 / ${snap.barCount} 小節)`,
      snap.trackCount === gp.tracks && snap.barCount === gp.bars && snap.title === gp.title, JSON.stringify(snap.title));
    const kept = await page.evaluate((wanted) => {
      // 不要只找某一軌,改的是「當時顯示中的那一軌」
      for (const track of window.at.score.tracks) {
        for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
          for (const note of beat.notes) {
            if (note.string === wanted.string && note.fret === wanted.fret) return { found: true, track: track.name };
          }
        }
      }
      return { found: false };
    }, { string: edited.string, fret: edited.fret });
    check(`改動有存進檔案(第 ${edited.string} 弦 ${edited.fret} 格,在「${kept.track ?? "?"}」)`, kept.found, JSON.stringify(kept));

    // 改了譜沒存就換歌,改動會直接消失,所以換歌前要先詢問。
    await page.click("#edit-button");
    await page.evaluate(() => window.scoreEditor.selectFirstNote());
    await settle(600);
    const dirtyFret = (await page.evaluate(() => window.scoreEditor.getSnapshot())).fret;
    await page.evaluate((v) => window.scoreEditor.typeFret(v), dirtyFret === 3 ? "7" : "3");
    await settle(800);
    check("改完會標成「尚未存檔」", (await page.evaluate(() => window.scoreEditor.getSnapshot())).dirty);
    let askedMessage = null;
    page.once("dialog", async (dialog) => { askedMessage = dialog.message(); await dialog.dismiss(); });
    await page.selectOption("#song-select", "0");
    await settle(1200);
    check("換歌之前會先問", Boolean(askedMessage) && askedMessage.includes("還沒存"), String(askedMessage).slice(0, 30));
    // 不要寫死編號:scores/ 多一份譜,清單順序就會改變。
    check("按取消之後曲目沒有被換掉", (await snapshot()).songIndex === gpIndex, JSON.stringify((await snapshot()).songIndex));
    check("按取消之後改動還在", (await page.evaluate(() => window.scoreEditor.getSnapshot())).dirty);
    // 這次讓它換過去
    page.once("dialog", async (dialog) => { await dialog.accept(); });
    await page.click("#edit-button");

    // 換回第一首,確認曲目切換兩邊都通
    await page.selectOption("#song-select", "0");
    await page.waitForFunction(() => window.scorePlayer.getSnapshot().songIndex === 0, null, { timeout: 60000 });
    await rendered();
    await page.screenshot({ path: shots.firstSong });
    check("切回第一首也正常", (await snapshot()).ready);
    // 鋼琴沒有調弦資料,一度被誤判成打擊樂器。這裡驗它標對了。
    const firstTrackKind = await page.locator(".track .track-sub").first().textContent();
    check("鋼琴不會被標成打擊樂器", firstTrackKind?.trim() !== "打擊", firstTrackKind ?? "");

    // 鋼琴這種沒有弦的音軌:上下鍵改的是音高,不是換弦
    await page.click("#edit-button");
    await page.evaluate(() => window.scoreEditor.selectFirstNote());
    await settle(700);
    let piano = await page.evaluate(() => window.scoreEditor.getSnapshot());
    check(`鋼琴軌認得出來沒有格位(MIDI ${piano.midi})`,
      piano.stringed === false && Number.isFinite(piano.midi),
      JSON.stringify({ stringed: piano.stringed, midi: piano.midi }));
    const midiBefore = piano.midi;
    await page.evaluate(() => window.scoreEditor.transposeNote(1));
    await settle(700);
    piano = await page.evaluate(() => window.scoreEditor.getSnapshot());
    check(`鋼琴軌改得動音高(${midiBefore} → ${piano.midi})`, piano.midi === midiBefore + 1, JSON.stringify(piano.midi));
    await page.evaluate(() => window.scoreEditor.undoLast());
    await settle(700);
    check("改音高收得回來", (await page.evaluate(() => window.scoreEditor.getSnapshot())).midi === midiBefore);
    await page.click("#edit-button");

    // 「開啟檔案」要能直接吃 .gp5(不必先轉檔)
    await page.setInputFiles("#score-file", path.join(root, "scores", gp.file));
    await page.waitForFunction((n) => window.scorePlayer.getSnapshot().trackCount === n, gp.tracks, { timeout: 60000 });
    await rendered();
    snap = await snapshot();
    check("開啟檔案直接吃 .gp5", snap.trackCount === gp.tracks && snap.title === gp.title, `${snap.title} / ${snap.trackCount} 軌`);
    check("從檔案開的也不會有亂碼", snap.trackNames.includes(gp.trackName), snap.trackNames.join(" / "));
  }

  // 說明視窗:四個分頁都要切得動(v1.0 的操作全部寫在裡面)
  await page.click("#help-button");
  await page.waitForSelector("#guide[open]");
  check("說明有四個分頁", await page.locator("[data-guide]").count() === 4);
  await page.click('[data-guide="edit"]');
  await settle(200);
  const guidePage = await page.evaluate(() => {
    const shown = [...document.querySelectorAll(".guide-page")].filter((p) => !p.hidden);
    return { count: shown.length, page: shown[0]?.dataset.page ?? null };
  });
  check("切分頁只會顯示那一頁", guidePage.count === 1 && guidePage.page === "edit", JSON.stringify(guidePage));
  check("說明視窗有右上角的關閉叉叉", await page.locator("#guide .dlg-close").count() === 1);
  await page.evaluate(() => document.querySelector("#guide").close());

  // ── 薩克斯風按鍵圖 ──
  // 這張表是從 Yamaha 原廠 PDF 量出來的。表錯了不會有任何錯誤訊息,
  //    使用者會照著錯的按鍵練習,所以這裡用人工核對過的 9 個音再驗一次。
  const chart = await page.evaluate(() => {
    const L1 = 6, L2 = 4, L3 = 5, R1 = 3, R2 = 2, R3 = 1, OCT = 24, LOWC = 7;
    // 來源:姊妹專案 saxophone_score_making 的指法表,已用實際樂器逐音核對
    const want = {
      60: [L1, L2, L3, R1, R2, R3, LOWC], 62: [L1, L2, L3, R1, R2, R3],
      64: [L1, L2, L3, R1, R2], 65: [L1, L2, L3, R1], 67: [L1, L2, L3],
      69: [L1, L2], 71: [L1], 72: [L2], 74: [OCT, L1, L2, L3, R1, R2, R3],
    };
    const key = (a) => [...a].sort((x, y) => x - y).join(",");
    const bad = Object.entries(want)
      .filter(([midi, keys]) => key(window.scoreSaxFingering.chart.fingerings[midi]?.[0] ?? []) !== key(keys))
      .map(([midi]) => midi);
    return { bad, range: window.scoreSaxFingering.range,
             notes: Object.keys(window.scoreSaxFingering.chart.fingerings).length };
  });
  check(`指法表跟人工核對過的 9 個音相符(表上 ${chart.notes} 個音,${chart.range[0]}~${chart.range[1]})`,
    chart.bad.length === 0 && chart.notes === 34, JSON.stringify(chart.bad));

  // 清單上的標籤是檔名去掉底線,不是檔名本身(Ode_to_Joy_sax → "Ode to Joy sax")。
  const saxIndex = songs.findIndex((label) => /sax/i.test(label));
  check("曲目清單有薩克斯風那首", saxIndex >= 0, songs.join(" / "));
  // 只有一首曲子時選單會隱藏(那首本來就是目前的曲子),這時不必切換。
  if ((await snapshot()).songIndex !== saxIndex) {
    await page.selectOption("#song-select", String(saxIndex));
  }
  await page.waitForFunction((i) => window.scorePlayer.getSnapshot().songIndex === i, saxIndex, { timeout: 60000 });
  await rendered();
  await page.click("#fretboard-button");
  await settle(500);
  check("薩克斯風軌會自己切成按鍵圖",
    (await page.evaluate(() => window.scoreFretboard.getSnapshot())).sax,
    JSON.stringify(await page.evaluate(() => window.scoreFretboard.getSnapshot())));

  await page.evaluate(() => window.scorePlayer.seekToBar(0));
  await page.click("#play");
  // 不要等固定秒數 —— 等到真的有鍵亮起來
  await page.waitForFunction(() => window.scoreSaxFingering.getSnapshot().pressed > 0, null, { timeout: 20000 })
    .catch(() => {});
  const sax = await page.evaluate(() => window.scoreSaxFingering.getSnapshot());
  await page.click("#play");
  check(`播放時按鍵圖會亮(${sax.pitch} / ${sax.pressed} 顆鍵)`,
    sax.pressed > 0 && Boolean(sax.pitch), JSON.stringify(sax));
  // 暫停之後手型要留著,理由跟指板圖那條一樣
  check("暫停後按鍵圖還留著",
    (await page.evaluate(() => window.scoreSaxFingering.getSnapshot())).pressed > 0);
  await page.screenshot({ path: shots.sax });

  // 超出原廠指法表的音要明確說明,不要畫一張空白的圖
  const outside = await page.evaluate(() => {
    window.scoreSaxFingering.drawSaxFingering(40);
    return document.querySelector("#fretboard").textContent ?? "";
  });
  check("音超出原廠指法表會明講", outside.includes("不在原廠指法表裡"), outside.trim().slice(0, 40));
  await page.click("#fretboard-button");

  // 版面不能爆出去
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("版面沒有橫向溢出", !overflow);
  check("瀏覽器沒有噴錯", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error("\n❌ 沒過的項目:");
  for (const line of problems) console.error(`   ${line}`);
  process.exit(1);
}
console.log(`\n✅ 全部通過。截圖:\n  ${Object.values(shots).join("\n  ")}`);
